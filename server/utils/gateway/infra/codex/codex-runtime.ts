import type { HostWithSecret, RemoteCodexVersionState } from "../ssh/ssh-types";
import { isRecoverableCodexInstallError } from "./codex-install-errors";
import { isCodexVersionAtLeast, SUPPORTED_CODEX_VERSION } from "./codex-version";
import { hostLifecycleBus } from "../../state/host-events";
import { currentGatewayUserId } from "../../state/memory";
import type { SshConnectionPool } from "../ssh/ssh-connection";
import { AppServerRuntimeProbe } from "./app-server-runtime-probe";
import { CodexUpgrader } from "./codex-upgrader";
import { CodexUpgradeWorkflow } from "./codex-upgrade-workflow";
import { CodexVersionChecker } from "./codex-version-checker";
import { HostVerifyService } from "../host-verify-service";
import { serverText } from "../../notifications/locale";

export class CodexRuntimeService {
  private readonly versionChecks = new Map<string, Promise<RemoteCodexVersionState>>();
  private readonly failedVersionChecks = new Map<string, { error: unknown; retryAt: number }>();
  private readonly deferredUpgradeChecks = new Map<string, Promise<boolean>>();
  private readonly upgradeWorkflow: CodexUpgradeWorkflow;
  private readonly appServerRuntime: AppServerRuntimeProbe;
  private readonly upgrader: CodexUpgrader;
  private readonly versionChecker: CodexVersionChecker;
  private readonly verifier: HostVerifyService;

  constructor(ssh: SshConnectionPool) {
    this.appServerRuntime = new AppServerRuntimeProbe(ssh);
    this.upgrader = new CodexUpgrader(ssh);
    this.versionChecker = new CodexVersionChecker(ssh);
    this.upgradeWorkflow = new CodexUpgradeWorkflow(
      this.appServerRuntime,
      this.upgrader,
      this.versionChecker,
    );
    this.verifier = new HostVerifyService(ssh, (host) => this.ensureCodexVersion(host));
  }

  async verify(host: HostWithSecret) {
    return await this.verifier.verify(host);
  }

  async ensureCodexVersion(host: HostWithSecret): Promise<RemoteCodexVersionState> {
    // Never share an in-flight managed check with a newly external connection.
    if (host.codexRuntimeMode === "external") return await this.checkExternalRuntime(host);
    const key = this.hostKey(host.id);
    const existing = this.versionChecks.get(key);
    if (existing) {
      return existing;
    }

    const failed = this.failedVersionChecks.get(key);
    if (failed !== undefined) {
      if (failed.retryAt > Date.now()) {
        // A failed SSH probe can be triggered by several browser requests at once. Reusing the
        // short-lived failure prevents each request from opening another SSH/upgrade attempt while
        // the remote host or its proxy path is unavailable.
        throw failed.error;
      }
      this.failedVersionChecks.delete(key);
    }

    const check = this.checkAndUpgradeCodex(host)
      .then((result) => {
        this.failedVersionChecks.delete(key);
        return result;
      })
      .catch((error: unknown) => {
        this.failedVersionChecks.set(key, {
          error,
          retryAt: Date.now() + VERSION_CHECK_FAILURE_COOLDOWN_MS,
        });
        throw error;
      })
      .finally(() => this.versionChecks.delete(key));
    this.versionChecks.set(key, check);
    return check;
  }

  async checkAndUpgradeCodex(host: HostWithSecret): Promise<RemoteCodexVersionState> {
    if (host.codexRuntimeMode === "external") return await this.checkExternalRuntime(host);
    try {
      hostLifecycleBus.emit({
        hostId: host.id,
        status: "checkingVersion",
        message: serverText(
          `Checking the remote Codex version on ${hostDisplayName(host)}`,
          `正在检查 ${hostDisplayName(host)} 的远端 Codex 版本`,
        ),
      });
      const supportedVersion = SUPPORTED_CODEX_VERSION;
      const installed = await this.versionChecker.readVersionOrRecoverableMissing(host);
      const beforeVersion = installed.version;
      const runtimeState = await this.appServerRuntime.readState(host);
      const appServerVersion = runtimeState.appServerVersion;
      const currentRuntimeVersion = appServerVersion ?? beforeVersion;
      const cliVersionSupported =
        isCodexVersionAtLeast(beforeVersion, supportedVersion) &&
        installed.installationLayout === "standalone";
      const runtimeVersionSupported = isCodexVersionAtLeast(
        currentRuntimeVersion,
        supportedVersion,
      );

      if (
        runtimeState.running === true &&
        runtimeState.versionError !== null &&
        runtimeState.versionError !== ""
      ) {
        hostLifecycleBus.emit({
          hostId: host.id,
          status: "restarting",
          message: serverText(
            `Restarting Codex app-server on ${hostDisplayName(host)} after handshake failure: ${runtimeState.versionError}`,
            `${hostDisplayName(host)} 的远端 Codex app-server 无法握手，正在重启：${runtimeState.versionError}`,
          ),
        });
        await this.appServerRuntime.terminateUnmanaged(host);
        return {
          version: beforeVersion,
          installationLayout: installed.installationLayout,
          appServerVersion: null,
          supportedVersion,
          beforeVersion,
          upgraded: false,
        };
      }

      if (cliVersionSupported && runtimeVersionSupported) {
        hostLifecycleBus.emit({
          hostId: host.id,
          status: "connecting",
          message: serverText(
            `Remote Codex on ${hostDisplayName(host)} is up to date (${beforeVersion})`,
            `${hostDisplayName(host)} 的远端 Codex 已是最新版本 ${beforeVersion}`,
          ),
        });
        return {
          version: beforeVersion,
          installationLayout: installed.installationLayout,
          appServerVersion,
          supportedVersion,
          beforeVersion,
          upgraded: false,
        };
      }

      if (runtimeState.running) {
        if (await this.appServerRuntime.hasActiveLoadedThread(host)) {
          hostLifecycleBus.emit({
            hostId: host.id,
            status: "connecting",
            message: serverText(
              `Active conversations on ${hostDisplayName(host)}; Codex ${currentRuntimeVersion} -> ${supportedVersion} upgrade deferred`,
              `${hostDisplayName(host)} 仍有活动对话，Codex ${currentRuntimeVersion} -> ${supportedVersion} 升级已延后`,
            ),
          });
          return {
            version: beforeVersion,
            installationLayout: installed.installationLayout,
            appServerVersion,
            supportedVersion,
            beforeVersion,
            upgraded: false,
            deferredUpgrade: true,
          };
        }
      }

      if (!cliVersionSupported) {
        return await this.upgradeWorkflow.upgradeOutdatedCli(host, supportedVersion, beforeVersion);
      }

      if (runtimeState.running) await this.appServerRuntime.terminateUnmanaged(host);
      hostLifecycleBus.emit({
        hostId: host.id,
        status: "restarting",
        message: serverText(
          `Codex CLI on ${hostDisplayName(host)} is ${beforeVersion}; restarting old app-server ${currentRuntimeVersion}`,
          `${hostDisplayName(host)} 的远端 Codex CLI 已是 ${beforeVersion}，正在重启旧 app-server ${currentRuntimeVersion}`,
        ),
      });
      return {
        version: beforeVersion,
        installationLayout: installed.installationLayout,
        appServerVersion: null,
        supportedVersion,
        beforeVersion,
        upgraded: false,
      };
    } catch (error) {
      hostLifecycleBus.emit({
        hostId: host.id,
        status: "failed",
        message: messageFromError(error),
      });
      throw error;
    }
  }

  clearVersionCheck(hostId: number) {
    const key = this.hostKey(hostId);
    this.versionChecks.delete(key);
    this.failedVersionChecks.delete(key);
  }

  completeDeferredUpgrade(host: HostWithSecret) {
    if (host.codexRuntimeMode === "external") return Promise.resolve(false);
    const key = this.hostKey(host.id);
    const pending = this.deferredUpgradeChecks.get(key);
    if (pending) return pending;

    const check = this.stopIdleOutdatedRuntime(host).finally(() => {
      if (this.deferredUpgradeChecks.get(key) === check) {
        this.deferredUpgradeChecks.delete(key);
      }
    });
    this.deferredUpgradeChecks.set(key, check);
    return check;
  }

  async repairAfterProxyFailure(
    host: HostWithSecret,
    error: unknown,
  ): Promise<RemoteCodexVersionState> {
    if (host.codexRuntimeMode === "external") throw error;
    if (!isRecoverableCodexInstallError(error)) {
      throw error;
    }

    hostLifecycleBus.emit({
      hostId: host.id,
      status: "upgrading",
      message: serverText(
        `Codex app-server failed to start on ${hostDisplayName(host)}; reinstalling ${SUPPORTED_CODEX_VERSION}: ${messageFromError(error)}`,
        `${hostDisplayName(host)} 的远端 Codex app-server 启动失败，正在重新安装 ${SUPPORTED_CODEX_VERSION}：${messageFromError(error)}`,
      ),
    });

    return await this.upgradeWorkflow.repair(host);
  }

  private async checkExternalRuntime(host: HostWithSecret): Promise<RemoteCodexVersionState> {
    // Read only: missing/broken installations must not enter the repair workflow.
    const installed = await this.versionChecker.readVersion(host);
    const supportedVersion = SUPPORTED_CODEX_VERSION;
    if (!isCodexVersionAtLeast(installed.version, supportedVersion)) {
      throw new Error(
        `Externally managed Codex ${installed.version} requires ${supportedVersion} or newer. Update it outside Gateway.`,
      );
    }
    const runtime = await this.appServerRuntime.readState(host);
    if (!runtime.running) {
      throw new Error(
        "Externally managed Codex app-server is not running. Start it outside Gateway.",
      );
    }
    if (runtime.versionError !== null || runtime.appServerVersion === null) {
      throw new Error(
        "Cannot verify the externally managed app-server version. Check the server outside Gateway; no repair was attempted.",
      );
    }
    if (!isCodexVersionAtLeast(runtime.appServerVersion, supportedVersion)) {
      throw new Error(
        `Externally managed app-server ${runtime.appServerVersion} requires ${supportedVersion} or newer. Update and restart it outside Gateway.`,
      );
    }
    return {
      ...installed,
      appServerVersion: runtime.appServerVersion,
      supportedVersion,
      beforeVersion: installed.version,
      upgraded: false,
    };
  }

  private async stopIdleOutdatedRuntime(host: HostWithSecret) {
    if (await this.appServerRuntime.hasActiveLoadedThread(host)) return false;
    hostLifecycleBus.emit({
      hostId: host.id,
      status: "restarting",
      message: serverText(
        `Active conversations on ${hostDisplayName(host)} have finished; applying the deferred Codex upgrade`,
        `${hostDisplayName(host)} 的活动对话已结束，正在执行延后的 Codex 升级`,
      ),
    });
    await this.appServerRuntime.terminateUnmanaged(host);
    this.clearVersionCheck(host.id);
    return true;
  }

  private hostKey(hostId: number) {
    return `${currentGatewayUserId() ?? "anonymous"}:${hostId}`;
  }
}

const VERSION_CHECK_FAILURE_COOLDOWN_MS = 30_000;

function hostDisplayName(host: HostWithSecret) {
  return host.name || host.sshHost;
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

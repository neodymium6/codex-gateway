import { SUPPORTED_CODEX_VERSION, isCodexVersionAtLeast } from "./codex-version";
import { hostLifecycleBus } from "../../state/host-events";
import type { HostWithSecret, RemoteCodexVersionState } from "../ssh/ssh-types";
import type { AppServerRuntimeProbe } from "./app-server-runtime-probe";
import type { CodexUpgrader } from "./codex-upgrader";
import { CodexUpgradeCoordinator } from "./codex-upgrade-queue";
import type { CodexVersionChecker } from "./codex-version-checker";
import { codexUpgradeLog } from "./codex-upgrade-log";
import type { CodexUpgradeResources } from "./codex-upgrade-resources";
import { assertCodexManagementAllowed } from "./codex-management-policy";
import { serverText } from "../../notifications/locale";

export class CodexUpgradeWorkflow {
  private readonly coordinator = new CodexUpgradeCoordinator();

  constructor(
    private readonly runtime: AppServerRuntimeProbe,
    private readonly upgrader: CodexUpgrader,
    private readonly versionChecker: CodexVersionChecker,
  ) {}

  async repair(host: HostWithSecret): Promise<RemoteCodexVersionState> {
    assertCodexManagementAllowed(host);
    return await this.runExclusive(host, async (resources, attempt) => {
      const beforeVersion = (await this.readVersionForRepair(host)).version;
      await this.stopRuntimeIfPresent(host);
      const version = await this.upgrader.upgrade(
        host,
        SUPPORTED_CODEX_VERSION,
        resources,
        attempt,
      );
      await this.runtime.ensureStoppedAfterUpgrade(host);

      return {
        version,
        installationLayout: "standalone",
        appServerVersion: null,
        supportedVersion: SUPPORTED_CODEX_VERSION,
        beforeVersion,
        upgraded: true,
      };
    });
  }

  async upgradeOutdatedCli(
    host: HostWithSecret,
    supportedVersion: string,
    observedBeforeVersion: string,
  ): Promise<RemoteCodexVersionState> {
    assertCodexManagementAllowed(host);
    return await this.runExclusive(host, async (resources, attempt) => {
      // Hosts can wait in this queue for several minutes. Re-read both CLI and app-server state
      // when this Host reaches the front so a newly started thread is never interrupted and an
      // externally completed upgrade is not repeated.
      const installed = await this.versionChecker.readVersionOrRecoverableMissing(host);
      const beforeVersion = installed.version;
      const runtimeState = await this.runtime.readState(host);
      const currentRuntimeVersion = runtimeState.appServerVersion ?? beforeVersion;
      const cliVersionSupported =
        isCodexVersionAtLeast(beforeVersion, supportedVersion) &&
        installed.installationLayout === "standalone";
      const runtimeVersionSupported = isCodexVersionAtLeast(
        currentRuntimeVersion,
        supportedVersion,
      );
      codexUpgradeLog("remote version inspected", host, {
        observedVersion: beforeVersion,
        installationLayout: installed.installationLayout,
        appServerVersion: runtimeState.appServerVersion,
        targetVersion: supportedVersion,
        runtimeRunning: runtimeState.running,
      });

      if (runtimeState.running && !runtimeVersionSupported) {
        if (await this.runtime.hasActiveLoadedThread(host)) {
          throw new Error(
            `Remote Codex runtime ${currentRuntimeVersion} is below supported ${supportedVersion}, but a loaded thread is active`,
          );
        }
      }

      if (cliVersionSupported) {
        if (runtimeState.running && !runtimeVersionSupported) {
          await this.runtime.terminateUnmanaged(host);
        }
        hostLifecycleBus.emit({
          hostId: host.id,
          status: runtimeVersionSupported ? "connecting" : "restarting",
          message: runtimeVersionSupported
            ? serverText(
                `Remote Codex on ${hostDisplayName(host)} is up to date (${beforeVersion})`,
                `${hostDisplayName(host)} 的远端 Codex 已是最新版本 ${beforeVersion}`,
              )
            : serverText(
                `Codex CLI on ${hostDisplayName(host)} is ${beforeVersion}; restarting old app-server ${currentRuntimeVersion}`,
                `${hostDisplayName(host)} 的远端 Codex CLI 已是 ${beforeVersion}，正在重启旧 app-server ${currentRuntimeVersion}`,
              ),
        });
        codexUpgradeLog("installation skipped", host, {
          observedVersion: beforeVersion,
          appServerVersion: runtimeState.appServerVersion,
          targetVersion: supportedVersion,
          runtimeRestartRequired: runtimeState.running && !runtimeVersionSupported,
        });
        return {
          version: beforeVersion,
          installationLayout: installed.installationLayout,
          appServerVersion: runtimeVersionSupported ? runtimeState.appServerVersion : null,
          supportedVersion,
          beforeVersion: observedBeforeVersion,
          upgraded: false,
        };
      }

      const version = await this.install(host, supportedVersion, beforeVersion, resources, attempt);
      return {
        version,
        installationLayout: "standalone",
        appServerVersion: null,
        supportedVersion,
        beforeVersion,
        upgraded: true,
      };
    });
  }

  private async install(
    host: HostWithSecret,
    supportedVersion: string,
    beforeVersion: string,
    resources: CodexUpgradeResources,
    attempt: number,
  ) {
    codexUpgradeLog("upgrade required", host, {
      observedVersion: beforeVersion,
      targetVersion: supportedVersion,
    });
    hostLifecycleBus.emit({
      hostId: host.id,
      status: "upgrading",
      message: serverText(
        `Preparing official Codex ${supportedVersion} standalone package for ${hostDisplayName(host)}`,
        `正在为 ${hostDisplayName(host)} 准备 Codex ${supportedVersion} 官方 standalone 安装包`,
      ),
    });
    const version = await this.upgrader.withPreparedUpgrade(
      host,
      supportedVersion,
      resources,
      attempt,
      async (install) => {
        const latestRuntimeState = await this.runtime.readState(host);
        if (latestRuntimeState.running) {
          if (await this.runtime.hasActiveLoadedThread(host)) {
            throw new Error(
              `Remote Codex runtime is below supported ${supportedVersion}, but a loaded thread became active while waiting to upgrade`,
            );
          }
          await this.runtime.terminateUnmanaged(host);
        }
        hostLifecycleBus.emit({
          hostId: host.id,
          status: "upgrading",
          message: serverText(
            `Upgrading remote Codex on ${hostDisplayName(host)} offline: ${beforeVersion} -> ${supportedVersion}`,
            `正在离线升级 ${hostDisplayName(host)} 的远端 Codex ${beforeVersion} -> ${supportedVersion}`,
          ),
        });
        return await install();
      },
    );
    await this.runtime.ensureStoppedAfterUpgrade(host);
    if (!isCodexVersionAtLeast(version, supportedVersion)) {
      throw new Error(
        `Remote Codex upgraded to ${version}, still below supported ${supportedVersion}`,
      );
    }
    hostLifecycleBus.emit({
      hostId: host.id,
      status: "restarting",
      message: serverText(
        `Remote Codex on ${hostDisplayName(host)} upgraded to ${version}; restarting app-server`,
        `${hostDisplayName(host)} 的远端 Codex 已升级到 ${version}，正在重启 app-server`,
      ),
    });
    return version;
  }

  private async runExclusive<T>(
    host: HostWithSecret,
    work: (resources: CodexUpgradeResources, attempt: number) => Promise<T>,
  ) {
    const resources = this.upgrader.createResources(host);
    try {
      return await this.coordinator.run(host, (attempt) => work(resources, attempt));
    } finally {
      await resources.dispose();
    }
  }

  private async readVersionForRepair(host: HostWithSecret) {
    try {
      return await this.versionChecker.readVersionOrRecoverableMissing(host);
    } catch {
      return { version: "0.0.0", installationLayout: "npm-or-external" } as const;
    }
  }

  private async stopRuntimeIfPresent(host: HostWithSecret) {
    const runtimeState = await this.runtime.readState(host);
    if (runtimeState.running) await this.runtime.terminateUnmanaged(host);
  }
}

function hostDisplayName(host: HostWithSecret) {
  return host.name || host.sshHost;
}

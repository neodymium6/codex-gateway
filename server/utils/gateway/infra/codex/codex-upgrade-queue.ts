import { currentGatewayUserId, runWithGatewayUser } from "../../state/memory";
import type { HostWithSecret } from "../ssh/ssh-types";
import { codexUpgradeError, codexUpgradeLog } from "./codex-upgrade-log";
import { KeyedTaskLimiter } from "../concurrency/keyed-task-limiter";
import { resolveSshConfig, sshConnectionKey } from "../ssh/ssh-config";

/**
 * Start upgrades for independent SSH targets immediately. Only the same physical target is
 * serialized, because two Gateway users may point at one remote account with different local Host
 * names and must not replace the same standalone installation concurrently.
 */
export class CodexUpgradeCoordinator {
  private readonly remoteTargetLimit = new KeyedTaskLimiter(1);

  async run<T>(host: HostWithSecret, work: (attempt: number) => Promise<T>) {
    // The lock is per physical target rather than global: unrelated hosts can upgrade in parallel,
    // while duplicate entries for one SSH identity are still re-checked after the first completes.
    return await this.remoteTargetLimit.run(remoteUpgradeTargetKey(host), async () => {
      return await this.runAttempt(host, work);
    });
  }

  private async runAttempt<T>(host: HostWithSecret, work: (attempt: number) => Promise<T>) {
    const userId = currentGatewayUserId();
    const run = async () => {
      const startedAt = Date.now();
      codexUpgradeLog("workflow started", host);
      try {
        const result = await work(1);
        codexUpgradeLog("workflow completed", host, { durationMs: Date.now() - startedAt });
        return result;
      } catch (error: unknown) {
        codexUpgradeError("workflow failed", host, error, {
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    };
    return await (userId === null ? run() : runWithGatewayUser(userId, run));
  }
}

function remoteUpgradeTargetKey(host: HostWithSecret) {
  // Do not include Gateway userId or the local Host name. The SSH connection key already captures
  // the resolved host, remote username, port, proxy, auth mode, and credential fingerprint while
  // intentionally omitting Gateway's user scope.
  return sshConnectionKey(host, resolveSshConfig(host));
}

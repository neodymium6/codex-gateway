import { currentGatewayUserId } from "../../state/memory";
import type { HostWithSecret } from "../ssh/ssh-types";
import { gatewayLog } from "../../logging";

type UpgradeLogDetails = Record<string, unknown>;

export function codexUpgradeLog(
  event: string,
  host: HostWithSecret,
  details: UpgradeLogDetails = {},
) {
  gatewayLog("info", "gateway-upgrade", event, upgradeLogRecord(event, host, details));
}

export function codexUpgradeError(
  event: string,
  host: HostWithSecret,
  error: unknown,
  details: UpgradeLogDetails = {},
) {
  gatewayLog("error", "gateway-upgrade", event, {
    ...upgradeLogRecord(event, host, {
      ...details,
      message: error instanceof Error ? error.message : String(error),
    }),
  });
}

function upgradeLogRecord(event: string, host: HostWithSecret, details: UpgradeLogDetails) {
  return {
    event,
    userId: currentGatewayUserId(),
    hostId: host.id,
    hostName: host.name || host.sshHost,
    sshHost: host.sshHost,
    ...details,
  };
}

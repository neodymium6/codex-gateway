import { gatewayLog } from "../logging";

export function runtimeLog(message: string, details: Record<string, unknown> = {}) {
  gatewayLog("info", "gateway-runtime", message, details);
}

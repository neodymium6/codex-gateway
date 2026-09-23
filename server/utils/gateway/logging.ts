type GatewayLogLevel = "debug" | "info" | "warn" | "error";

type GatewayLogDetails = Record<string, unknown>;

export function gatewayLog(
  level: GatewayLogLevel,
  scope: string,
  message: string,
  details: GatewayLogDetails = {},
) {
  const record = JSON.stringify({ message, ...details });
  const line = `[${scope}] ${record}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (level === "debug") {
    console.debug(line);
  } else {
    console.info(line);
  }
}

export function trustedNetworkConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.CODEX_GATEWAY_AUTH_MODE ?? "password";
  if (mode === "password") return null;
  if (mode !== "trusted-network") throw new Error("Invalid Gateway authentication mode");
  const username = env.CODEX_GATEWAY_TRUSTED_USER?.trim().toLowerCase();
  const origins = (env.CODEX_GATEWAY_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (username === undefined || username === "" || origins.length === 0)
    throw new Error("Trusted user and origins are required");
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password
    ) {
      throw new Error("Trusted origins must be exact HTTP(S) origins");
    }
  }
  return { username, origins };
}

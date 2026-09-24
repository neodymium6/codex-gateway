import { createError, getHeader, setHeader } from "h3";
import { trustedNetworkConfig } from "~~/server/utils/gateway/auth/trusted-network";
import { userStore } from "~~/server/utils/gateway/auth/users";

export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "no-store");
  let config;
  try {
    config = trustedNetworkConfig();
  } catch {
    throw createError({ statusCode: 503, statusMessage: "Invalid authentication configuration" });
  }
  if (config === null) return { mode: "password" as const };
  // Network restrictions are mandatory. Origin checks additionally prevent an
  // unrelated website from using a trusted browser as a cross-origin deputy.
  const origin = getHeader(event, "origin");
  if (origin === undefined || !config.origins.includes(origin)) {
    throw createError({ statusCode: 403, statusMessage: "Origin is not allowed" });
  }
  const token = getHeader(event, "authorization")?.replace(/^Bearer /, "") ?? "";
  const user = userStore.authenticateToken(token);
  if (user?.username === config.username) {
    return { mode: "trusted-network" as const, session: { token, user } };
  }
  const session = userStore.loginTrusted(config.username);
  if (session === null) {
    throw createError({ statusCode: 403, statusMessage: "Trusted user is missing or inactive" });
  }
  return { mode: "trusted-network" as const, session };
});

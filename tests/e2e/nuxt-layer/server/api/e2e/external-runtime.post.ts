import { readValidatedBody } from "h3";
import { z } from "zod";
import { defineGatewayEventHandler } from "~~/server/utils/gateway/http/errors";
import { hostStore } from "~~/server/utils/gateway/state/hosts";
import { codexRuntime } from "~~/server/utils/gateway/infra/host-services";

// Only present in the test Nuxt layer. Exercise the real verification entry point
// against the disposable SSH fixture, without creating a model turn.
export default defineGatewayEventHandler(async (event) => {
  const { hostId } = await readValidatedBody(event, (body) =>
    z.object({ hostId: z.number().int().positive() }).parse(body),
  );
  const host = hostStore.getWithSecret(hostId);
  if (!host || host.codexRuntimeMode !== "external") throw new Error("External host required");
  try {
    const result = await codexRuntime.verify(host);
    return { ok: result.ok, upgraded: result.upgraded, appServerVersion: result.appServerVersion };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
});

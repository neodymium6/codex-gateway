import { readValidatedBody } from "h3";
import { z } from "zod";
import { defineGatewayEventHandler } from "~~/server/utils/gateway/http/errors";
import { requireRecord } from "~~/server/utils/gateway/http/validation/common";
import { hostStore } from "~~/server/utils/gateway/state/hosts";
import { codexRuntime } from "~~/server/utils/gateway/infra/host-services";

// Test-layer only: real SSH, runtime negotiation and thread/list, but no model turn.
export default defineGatewayEventHandler(async (event) => {
  const { hostId } = await readValidatedBody(event, (body) =>
    z.object({ hostId: z.number().int().positive() }).parse(body),
  );
  const host = requireRecord(hostStore.getWithSecret(hostId), "Host not found");
  const result = await codexRuntime.verify(host);
  return {
    ok: result.ok,
    appServerVersion: result.appServerVersion,
    supportedCodexVersion: result.supportedCodexVersion,
    threads: result.threads,
  };
});

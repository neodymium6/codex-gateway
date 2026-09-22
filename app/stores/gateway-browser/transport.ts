import type { BrowserPreviewTarget } from "~~/shared/types";
import { useGatewayRealtimeStore } from "../gateway-realtime";
import { useGatewayBootstrapStore } from "../gateway-bootstrap";
import { expectBrowserClosed, expectBrowserOpened } from "../gateway-realtime/response-parsers";
import { messageFromError } from "../gateway/thread-utils/identity";

export async function openBrowserPreview(input: BrowserPreviewTarget) {
  // Browser panels also carry UI-only fields such as `title`. TypeScript's structural typing
  // permits those objects at this call site, so project the official wire target explicitly.
  // Do not loosen the realtime parser: strict protocol boundaries are what catch accidental UI
  // state leakage before it reaches the server.
  const target = browserPreviewWireTarget(input);
  const response = await useGatewayRealtimeStore().request(
    (requestId) => ({ type: "browser.open", requestId, ...target }),
    expectBrowserOpened,
    { timeoutMs: 30_000 },
  );
  // browser.opened is projected into Pinia by the realtime domain subscriber before the request
  // broker resolves this promise. Writing the same session here as well recreates a declarative
  // iframe src during its one-time ticket exchange, so keep one event-owned state boundary.
  return response.session;
}

function browserPreviewWireTarget(input: BrowserPreviewTarget): BrowserPreviewTarget {
  return {
    hostId: input.hostId,
    projectId: input.projectId,
    threadId: input.threadId,
    panelId: input.panelId,
    targetUrl: input.targetUrl,
    allowInsecureTls: input.allowInsecureTls,
  };
}

export async function closeBrowserPreview(sessionId: string) {
  const gateway = useGatewayBootstrapStore();
  try {
    await useGatewayRealtimeStore().request(
      (requestId) => ({ type: "browser.close", requestId, sessionId }),
      expectBrowserClosed,
    );
    // browser.closed owns removal for the same reason browser.opened owns insertion: one realtime
    // event boundary keeps every browser tab consistent and preserves the session on close failure.
  } catch (error: unknown) {
    gateway.setError(
      messageFromError(error, gateway.t("app.closeBrowserPreviewFailed"), gateway.errorLabels),
    );
  }
}

export async function setBrowserPreviewInsecureTls(sessionId: string, allowInsecureTls: boolean) {
  const response = await useGatewayRealtimeStore().request(
    (requestId) => ({
      type: "browser.allowInsecureTls",
      requestId,
      sessionId,
      allowInsecureTls,
    }),
    expectBrowserOpened,
  );
  return response.session;
}

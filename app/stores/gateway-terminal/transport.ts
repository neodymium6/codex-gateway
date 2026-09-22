import { useGatewayTerminalStore } from "@/stores/gateway-terminal";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { useGatewayWorkspaceLayoutStore } from "@/stores/gateway-workspace-layout";
import { terminalWorkspacePanelId } from "../gateway/workspace-panels";
import type { ErrorMessageLabels } from "../gateway/thread-utils/identity";
import { messageFromError } from "../gateway/thread-utils/identity";
import type { GatewayErrorContext } from "../gateway/errors";
import type { TerminalOpenInput } from "../gateway/types";
import { expectTerminalClosed, expectTerminalOpened } from "../gateway-realtime/response-parsers";
import { captureSessionEpoch } from "@/utils/session-epoch";
import {
  encodeTerminalInputFrame,
  encodeTerminalResizeFrame,
} from "~~/shared/runtime/terminal-stream";

export interface GatewayTerminalTransportContext {
  t: (key: string, values?: Record<string, unknown>) => string;
  errorLabels: ErrorMessageLabels;
  setError: (message: string, context?: GatewayErrorContext) => void;
}

export async function openTerminalSession(
  ctx: GatewayTerminalTransportContext,
  input: TerminalOpenInput,
) {
  const sessionIsCurrent = captureSessionEpoch();
  const terminalStore = useGatewayTerminalStore();
  try {
    const response = await useGatewayRealtimeStore().request(
      (requestId) => ({
        type: "terminal.open",
        requestId,
        ...input,
        cols: input.cols ?? 80,
        rows: input.rows ?? 24,
      }),
      expectTerminalOpened,
      { timeoutMs: 30_000 },
    );
    if (!sessionIsCurrent()) return response.session;
    terminalStore.upsertTerminalSession(response.session);
    useGatewayWorkspaceLayoutStore().requestPanelActivation(
      terminalWorkspacePanelId(response.session.sessionId),
    );
    return response.session;
  } catch (error: unknown) {
    if (!sessionIsCurrent()) throw error;
    ctx.setError(messageFromError(error, ctx.t("app.openTerminalFailed"), ctx.errorLabels), {
      hostId: input.hostId,
      projectId: input.projectId ?? null,
      threadId: input.threadId ?? null,
    });
    throw error;
  }
}

export function sendTerminalInput(
  _ctx: GatewayTerminalTransportContext,
  sessionId: string,
  data: string,
) {
  useGatewayRealtimeStore().sendBinary(encodeTerminalInputFrame(sessionId, data));
}

export function resizeTerminal(
  _ctx: GatewayTerminalTransportContext,
  sessionId: string,
  cols: number,
  rows: number,
) {
  useGatewayRealtimeStore().sendBinary(encodeTerminalResizeFrame(sessionId, cols, rows));
}

export async function closeTerminalSession(
  ctx: GatewayTerminalTransportContext,
  sessionId: string,
) {
  try {
    await useGatewayRealtimeStore().request(
      (requestId) => ({
        type: "terminal.close",
        requestId,
        sessionId,
      }),
      expectTerminalClosed,
    );
    // terminal.closed is the authoritative commit and removes the session through the realtime
    // domain subscriber. Keeping the session until that acknowledgement prevents a failed close
    // from leaving an invisible server-side terminal alive.
  } catch (error: unknown) {
    ctx.setError(messageFromError(error, ctx.t("app.closeTerminalFailed"), ctx.errorLabels));
  }
}

import type { Page, WebSocketRoute } from "@playwright/test";
import type {
  GatewayEvent,
  ProjectRecord,
  RealtimeClientMessage,
  RealtimeServerMessage,
  ThreadHistoryState,
  ThreadSettingsState,
  ThreadTokenUsageState,
} from "../../../shared/types";
import type { AppServerTimelinePage } from "../../../shared/runtime/app-server";
import { parseThreadTimelinePage } from "../../../shared/runtime/app-server";
import { parseRealtimeClientMessage } from "../../../shared/runtime/realtime";
import { projectThreadTimelineHistory } from "../../../shared/thread-history/timeline";
import { gatewayThreadFixture, type GatewayThreadFixture } from "../fixtures/gateway-thread";

export interface MockThreadSnapshotInput {
  hostId?: number;
  responseDelayMs?: number;
  snapshots: Record<
    string,
    {
      thread?: GatewayThreadFixture;
      history?: ThreadHistoryState;
      projectId?: number | null;
      project?: ProjectRecord | null;
      threadSettings?: ThreadSettingsState;
      tokenUsage?: ThreadTokenUsageState | null;
      oldestTimelineCursor?: string | null;
      recentEvents?: GatewayEvent[];
      lastEventId?: number;
      eventEpoch?: string;
      runtimeStatus?: "idle" | "running" | "completed" | "failed" | "interrupted" | null;
    }
  >;
}

interface RealtimeRouteState {
  snapshots: MockThreadSnapshotInput | null;
  activateRequests: RealtimeClientMessage[];
  captureInterrupts: boolean;
  interruptRequest: Extract<RealtimeClientMessage, { type: "turn.interrupt" }> | null;
  serverRequestResponse: ServerRequestResponseRouteState | null;
  threadTimelineLoad: ThreadTimelineLoadRouteState | null;
}

interface RealtimeRouteConnection {
  route: WebSocketRoute;
  upstream: WebSocketRoute;
}

type ServerRequestResponseRouteState =
  | {
      mode: "capture";
      request: Extract<RealtimeClientMessage, { type: "serverRequest.respond" }> | null;
    }
  | { mode: "fail"; message: string };

interface ThreadTimelineLoadRouteState {
  deferred: boolean;
  requests: Array<{
    connection: RealtimeRouteConnection;
    message: Extract<RealtimeClientMessage, { type: "thread.timeline.load" }>;
  }>;
  response: AppServerTimelinePage;
}

export interface ThreadTimelineLoadResponseInput {
  history: ThreadHistoryState;
  nextCursor: string | null;
}

const routes = new WeakMap<Page, RealtimeRouteState>();

export async function installRealtimeRoute(page: Page) {
  if (routes.has(page)) return;

  const state: RealtimeRouteState = {
    snapshots: null,
    activateRequests: [],
    captureInterrupts: false,
    interruptRequest: null,
    serverRequestResponse: null,
    threadTimelineLoad: null,
  };
  routes.set(page, state);
  await page.routeWebSocket(/\/api\/realtime$/, (route) => {
    const connection = { route, upstream: route.connectToServer() };
    route.onMessage((raw) => handleClientMessage(state, connection, raw));
  });
}

export async function installRealtimeThreadSnapshotRoute(
  page: Page,
  input: MockThreadSnapshotInput,
) {
  const state = requireRealtimeRoute(page);
  state.snapshots = input;
  state.activateRequests = [];
}

export function installRealtimeInterruptRoute(page: Page) {
  const state = requireRealtimeRoute(page);
  state.captureInterrupts = true;
  state.interruptRequest = null;
}

export function installRealtimeServerRequestResponseRoute(
  page: Page,
  input: { mode: "capture" } | { mode: "fail"; message: string },
) {
  const state = requireRealtimeRoute(page);
  state.serverRequestResponse =
    input.mode === "capture" ? { mode: "capture", request: null } : input;
}

export function realtimeServerRequestResponse(page: Page) {
  const route = routes.get(page)?.serverRequestResponse;
  return route?.mode === "capture" ? route.request : null;
}

export function realtimeInterruptRequest(page: Page) {
  return routes.get(page)?.interruptRequest ?? null;
}

export function installRealtimeThreadTimelineLoadRoute(
  page: Page,
  response: ThreadTimelineLoadResponseInput,
  deferred: boolean,
) {
  const state = requireRealtimeRoute(page);
  const timelinePage = timelinePageFromHistory(response.history, response.nextCursor);
  state.threadTimelineLoad = {
    deferred,
    requests: [],
    response: timelinePage,
  };
}

export function releaseRealtimeThreadTimelineLoadRoute(page: Page) {
  const state = requireRealtimeRoute(page);
  const route = state.threadTimelineLoad;
  if (route === null) throw new Error("No deferred thread timeline route is installed");
  for (const request of route.requests) {
    sendThreadTimelinePage(request.connection, route.response, request.message);
  }
  route.deferred = false;
}

export function realtimeThreadTimelineLoadRequests(page: Page) {
  return (routes.get(page)?.threadTimelineLoad?.requests ?? []).map(({ message }) => message);
}

export function realtimeThreadActivateRequests(page: Page) {
  return [...(routes.get(page)?.activateRequests ?? [])];
}

function requireRealtimeRoute(page: Page) {
  const state = routes.get(page);
  if (!state) throw new Error("Install the realtime route before navigating with openApp");
  return state;
}

function handleClientMessage(
  state: RealtimeRouteState,
  connection: RealtimeRouteConnection,
  raw: string | Buffer,
) {
  const text = textRealtimeMessage(raw);
  if (text === null) {
    // Terminal input and resize use the production binary transport. The route only virtualizes
    // selected JSON requests; binary frames must remain a transparent browser-to-Gateway path.
    connection.upstream.send(raw);
    return;
  }
  const message = parseRealtimeClientMessage(JSON.parse(text));
  if (message.type === "thread.activate" && state.snapshots !== null) {
    handleThreadActivate(state, connection, message);
    return;
  }
  if (message.type === "turn.interrupt" && state.captureInterrupts) {
    handleTurnInterrupt(state, connection, message);
    return;
  }
  if (message.type === "serverRequest.respond" && state.serverRequestResponse !== null) {
    handleServerRequestResponse(connection, state.serverRequestResponse, message);
    return;
  }
  if (isThreadTimelineLoad(message) && state.threadTimelineLoad !== null) {
    state.threadTimelineLoad.requests.push({ connection, message });
    if (!state.threadTimelineLoad.deferred)
      sendThreadTimelinePage(connection, state.threadTimelineLoad.response, message);
    return;
  }
  connection.upstream.send(raw);
}

function textRealtimeMessage(raw: string | Buffer) {
  if (typeof raw === "string") return raw;
  const firstByte = raw.find((value) => !isAsciiWhitespace(value));
  return firstByte === 0x7b || firstByte === 0x5b ? raw.toString("utf8") : null;
}

function isAsciiWhitespace(value: number) {
  return value === 0x09 || value === 0x0a || value === 0x0d || value === 0x20;
}

function isThreadTimelineLoad(
  message: RealtimeClientMessage,
): message is Extract<RealtimeClientMessage, { type: "thread.timeline.load" }> {
  return message.type === "thread.timeline.load";
}

function sendThreadTimelinePage(
  connection: RealtimeRouteConnection,
  response: AppServerTimelinePage,
  request: Extract<RealtimeClientMessage, { type: "thread.timeline.load" }>,
) {
  send(connection, {
    type: "thread.timeline.page",
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
    ...response,
  });
}

function timelinePageFromHistory(history: ThreadHistoryState, nextCursor: string | null) {
  const data: unknown[] = [];
  let position = 0;
  for (const turn of history.thread.turns) {
    const turnId = String(turn.id ?? `turn-${position}`);
    data.push({
      type: "turnStarted",
      position: position++,
      turnId,
      startedAt: turn.startedAt ?? null,
    });
    for (const item of turn.items ?? []) {
      if (typeof item.id !== "string" || typeof item.type !== "string") continue;
      data.push({ type: "item", position: position++, turnId, item });
    }
    data.push({
      type: "turnCompleted",
      position: position++,
      turnId,
      status: typeof turn.status === "string" ? turn.status : "completed",
      error: turn.error ?? null,
      startedAt: turn.startedAt ?? null,
      completedAt: turn.completedAt ?? null,
      durationMs: turn.durationMs ?? null,
    });
  }
  return parseThreadTimelinePage({
    data,
    nextCursor,
    activeRealtimeSessionAtPageStart: null,
  });
}

function handleThreadActivate(
  state: RealtimeRouteState,
  connection: RealtimeRouteConnection,
  message: Extract<RealtimeClientMessage, { type: "thread.activate" }>,
) {
  state.activateRequests.push(message);
  const input = state.snapshots;
  const snapshot = input?.snapshots[message.threadId];
  if (!snapshot) {
    throw new Error(`Missing mocked thread snapshot for ${message.threadId}`);
  }
  const respond = () => {
    const thread = gatewayThreadFixture(snapshot.thread ?? { id: message.threadId }, {
      hostId: message.hostId ?? input.hostId ?? 1,
      projectId: snapshot.projectId ?? null,
    });
    send(connection, {
      type: "thread.snapshot",
      requestId: message.requestId,
      hostId: message.hostId ?? input.hostId ?? 1,
      threadId: message.threadId,
      thread,
      history: projectThreadTimelineHistory(
        snapshot.history ?? { thread: { id: message.threadId, turns: [] } },
      ),
      runtimeStatus: snapshot.runtimeStatus ?? null,
      projectId: snapshot.projectId ?? null,
      project: snapshot.project ?? null,
      threadSettings: snapshot.threadSettings ?? {},
      tokenUsage: snapshot.tokenUsage ?? null,
      oldestTimelineCursor: snapshot.oldestTimelineCursor ?? null,
      recentEvents: snapshot.recentEvents ?? [],
      lastEventId: snapshot.lastEventId ?? 0,
      eventEpoch: snapshot.eventEpoch ?? "e2e-event-epoch",
    });
  };
  if (input.responseDelayMs !== undefined && input.responseDelayMs > 0) {
    setTimeout(respond, input.responseDelayMs);
  } else respond();
}

function handleTurnInterrupt(
  state: RealtimeRouteState,
  connection: RealtimeRouteConnection,
  message: Extract<RealtimeClientMessage, { type: "turn.interrupt" }>,
) {
  state.interruptRequest = message;
  send(connection, {
    type: "turn.interrupt.accepted",
    requestId: message.requestId,
    hostId: message.hostId,
    threadId: message.threadId,
  });
}

function handleServerRequestResponse(
  connection: RealtimeRouteConnection,
  route: ServerRequestResponseRouteState,
  message: Extract<RealtimeClientMessage, { type: "serverRequest.respond" }>,
) {
  if (route.mode === "fail") {
    send(connection, {
      type: "error",
      requestId: message.requestId,
      request: message,
      message: route.message,
    });
    return;
  }
  route.request = message;
  send(connection, {
    type: "serverRequest.respond.accepted",
    requestId: message.requestId,
    hostId: message.hostId,
    threadId: message.threadId,
    serverRequestId: message.serverRequestId,
  });
}

function send(connection: RealtimeRouteConnection, message: RealtimeServerMessage) {
  connection.route.send(JSON.stringify(message));
}

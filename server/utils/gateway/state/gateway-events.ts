import type { GatewayEvent } from "~~/shared/types";
import type { AgentEvent } from "~~/shared/agent/events";
import { SERVER_THREAD_CACHE_LIMIT } from "~~/shared/config";
import { currentGatewayMemoryState } from "./memory";
import { randomUUID } from "node:crypto";

export const gatewayEventStore = {
  pruneToHosts(hostIds: Set<number>) {
    currentGatewayMemoryState().events = currentGatewayMemoryState().events.filter((event) =>
      hostIds.has(event.hostId),
    );
    currentGatewayMemoryState().eventPrunedThroughByThread = Object.fromEntries(
      Object.entries(currentGatewayMemoryState().eventPrunedThroughByThread).filter(([key]) =>
        hostIds.has(hostIdFromEventKey(key)),
      ),
    );
    currentGatewayMemoryState().eventEpochByHost = Object.fromEntries(
      Object.entries(currentGatewayMemoryState().eventEpochByHost).filter(([hostId]) =>
        hostIds.has(Number(hostId)),
      ),
    );
  },

  deleteForHost(hostId: number) {
    currentGatewayMemoryState().events = currentGatewayMemoryState().events.filter(
      (event) => event.hostId !== hostId,
    );
    currentGatewayMemoryState().eventPrunedThroughByThread = Object.fromEntries(
      Object.entries(currentGatewayMemoryState().eventPrunedThroughByThread).filter(
        ([key]) => hostIdFromEventKey(key) !== hostId,
      ),
    );
    this.rotateHostEpoch(hostId);
  },

  epoch(hostId: number) {
    const key = String(hostId);
    const existing = currentGatewayMemoryState().eventEpochByHost[key];
    if (existing !== undefined) return existing;
    const epoch = randomUUID();
    currentGatewayMemoryState().eventEpochByHost = {
      ...currentGatewayMemoryState().eventEpochByHost,
      [key]: epoch,
    };
    return epoch;
  },

  rotateHostEpoch(hostId: number) {
    currentGatewayMemoryState().eventEpochByHost = {
      ...currentGatewayMemoryState().eventEpochByHost,
      [String(hostId)]: randomUUID(),
    };
  },

  add(hostId: number, threadId: string, event: AgentEvent, createdAt: string): GatewayEvent {
    const gatewayEvent: GatewayEvent = {
      id: currentGatewayMemoryState().nextEventId++,
      hostId,
      threadId,
      event,
      createdAt,
    };
    currentGatewayMemoryState().events.push(gatewayEvent);
    this.prune(hostId, threadId, 500);
    this.pruneThreads(SERVER_THREAD_CACHE_LIMIT);
    return gatewayEvent;
  },

  list(hostId: number, threadId: string, afterId = 0, limit = 200): GatewayEvent[] {
    return currentGatewayMemoryState()
      .events.filter(
        (event) => event.hostId === hostId && event.threadId === threadId && event.id > afterId,
      )
      .sort((left, right) => left.id - right.id)
      .slice(0, limit);
  },

  latestId(hostId: number, threadId: string): number {
    return currentGatewayMemoryState().events.reduce((latest, event) => {
      if (event.hostId !== hostId || event.threadId !== threadId) {
        return latest;
      }
      return Math.max(latest, event.id);
    }, 0);
  },

  latest(hostId: number, threadId: string): GatewayEvent | null {
    return (
      currentGatewayMemoryState()
        .events.filter((event) => event.hostId === hostId && event.threadId === threadId)
        .sort((left, right) => right.id - left.id)[0] ?? null
    );
  },

  hasReplayGap(hostId: number, threadId: string, afterId: number) {
    if (afterId <= 0) return false;
    const latestId = this.latestId(hostId, threadId);
    return (
      afterId > latestId ||
      afterId <
        (currentGatewayMemoryState().eventPrunedThroughByThread[eventKey(hostId, threadId)] ?? 0)
    );
  },

  prune(hostId: number, threadId: string, keep: number) {
    const retained = currentGatewayMemoryState()
      .events.filter((event) => event.hostId === hostId && event.threadId === threadId)
      .sort((left, right) => right.id - left.id)
      .slice(0, keep)
      .map((event) => event.id);
    const retainedIds = new Set(retained);
    recordPrunedEvents(
      currentGatewayMemoryState().events.filter(
        (event) =>
          event.hostId === hostId && event.threadId === threadId && !retainedIds.has(event.id),
      ),
    );
    currentGatewayMemoryState().events = currentGatewayMemoryState().events.filter(
      (event) =>
        event.hostId !== hostId || event.threadId !== threadId || retainedIds.has(event.id),
    );
  },

  pruneThreads(keep: number) {
    const latestIds = new Map<string, number>();
    for (const event of currentGatewayMemoryState().events) {
      const key = `${event.hostId}:${event.threadId}`;
      latestIds.set(key, Math.max(latestIds.get(key) ?? 0, event.id));
    }
    if (latestIds.size <= keep) {
      return;
    }
    const retainedThreads = new Set(
      [...latestIds.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, keep)
        .map(([key]) => key),
    );
    recordPrunedEvents(
      currentGatewayMemoryState().events.filter(
        (event) => !retainedThreads.has(eventKey(event.hostId, event.threadId)),
      ),
    );
    currentGatewayMemoryState().events = currentGatewayMemoryState().events.filter((event) =>
      retainedThreads.has(eventKey(event.hostId, event.threadId)),
    );
  },
};

function recordPrunedEvents(events: GatewayEvent[]) {
  if (events.length === 0) return;
  const next = { ...currentGatewayMemoryState().eventPrunedThroughByThread };
  for (const event of events) {
    const key = eventKey(event.hostId, event.threadId);
    next[key] = Math.max(next[key] ?? 0, event.id);
  }
  currentGatewayMemoryState().eventPrunedThroughByThread = next;
}

function eventKey(hostId: number, threadId: string) {
  return `${hostId}:${threadId}`;
}

function hostIdFromEventKey(key: string) {
  return Number(key.slice(0, key.indexOf(":")));
}

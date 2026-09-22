import type { ThreadOpenSnapshot } from "../runtime/types";
import { SERVER_THREAD_CACHE_LIMIT } from "~~/shared/config";
import { currentGatewayMemoryState, nowIso } from "./memory";

export const threadSnapshotStore = {
  pruneToHosts(hostIds: Set<number>) {
    currentGatewayMemoryState().threadSnapshots =
      currentGatewayMemoryState().threadSnapshots.filter((record) => hostIds.has(record.hostId));
  },

  deleteForHost(hostId: number) {
    currentGatewayMemoryState().threadSnapshots =
      currentGatewayMemoryState().threadSnapshots.filter((record) => record.hostId !== hostId);
  },

  get(hostId: number, threadId: string): ThreadOpenSnapshot | null {
    const record = currentGatewayMemoryState().threadSnapshots.find(
      (candidate) => candidate.hostId === hostId && candidate.threadId === threadId,
    );
    if (record === undefined) {
      return null;
    }
    record.updatedAt = nowIso();
    return record.snapshot;
  },

  listForHost(hostId: number) {
    return currentGatewayMemoryState()
      .threadSnapshots.filter((record) => record.hostId === hostId)
      .map((record) => ({
        ...record,
        snapshot: record.snapshot,
      }));
  },

  set(hostId: number, threadId: string, snapshot: ThreadOpenSnapshot) {
    const updatedAt = nowIso();
    const index = currentGatewayMemoryState().threadSnapshots.findIndex(
      (record) => record.hostId === hostId && record.threadId === threadId,
    );
    const record = { hostId, threadId, snapshot, updatedAt };
    if (index >= 0) {
      currentGatewayMemoryState().threadSnapshots[index] = record;
    } else {
      currentGatewayMemoryState().threadSnapshots.push(record);
    }
    pruneOldestSnapshots();
  },

  update(
    hostId: number,
    threadId: string,
    updater: (snapshot: ThreadOpenSnapshot | null) => ThreadOpenSnapshot | null,
  ) {
    const nextSnapshot = updater(this.get(hostId, threadId));
    if (nextSnapshot !== null) {
      this.set(hostId, threadId, nextSnapshot);
    }
    return nextSnapshot;
  },
};

function pruneOldestSnapshots() {
  const overflow = currentGatewayMemoryState().threadSnapshots.length - SERVER_THREAD_CACHE_LIMIT;
  if (overflow <= 0) {
    return;
  }
  const evicted = new Set(
    [...currentGatewayMemoryState().threadSnapshots]
      .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
      .slice(0, overflow)
      .map((record) => `${record.hostId}:${record.threadId}`),
  );
  currentGatewayMemoryState().threadSnapshots = currentGatewayMemoryState().threadSnapshots.filter(
    (record) => !evicted.has(`${record.hostId}:${record.threadId}`),
  );
}

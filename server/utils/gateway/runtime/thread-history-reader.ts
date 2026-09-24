import type {
  AppServerThread,
  AppServerTimelinePage,
  HostRecord,
  ThreadTimelineItem,
} from "~~/shared/types";
import { parseThreadTimelinePage } from "~~/shared/runtime/app-server";
import {
  timelinePageItemsForTurn,
  timelinePagesItemsForTurn,
} from "~~/shared/thread-history/app-server-timeline";
import { threadSnapshotStore } from "../state/thread-snapshots";
import { threadTimelinePageStore } from "../state/thread-timeline-pages";
import type { ControllerRegistry } from "./controller-registry";
import { DEFAULT_TIMELINE_PAGE_LIMIT } from "./types";
import type { RecoveredTurnTail } from "./thread-tail-recovery";

export class ThreadHistoryReader {
  constructor(private readonly registry: ControllerRegistry) {}

  async loadInitialTimelinePage(host: HostRecord, thread: AppServerThread) {
    return this.fetchTimelinePage(host, thread.id, null);
  }

  async listTimelinePage(
    host: HostRecord,
    threadId: string,
    cursor: string | null,
    limit?: number,
  ) {
    this.requireSnapshot(host.id, threadId);
    return this.fetchTimelinePage(host, threadId, cursor, limit);
  }

  async readTurnItems(host: HostRecord, threadId: string, turnId: string) {
    this.requireSnapshot(host.id, threadId);
    const pages: AppServerTimelinePage[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let foundTurnStart = false;
    do {
      const page = await this.fetchTimelinePage(host, threadId, cursor);
      pages.push(page);
      foundTurnStart = page.data.some(
        (entry) => entry.type === "turnStarted" && entry.turnId === turnId,
      );
      cursor = foundTurnStart ? null : page.nextCursor;
      if (page.nextCursor !== null) {
        if (seenCursors.has(page.nextCursor)) {
          throw new Error("App Server returned a repeated timeline cursor");
        }
        seenCursors.add(page.nextCursor);
      }
    } while (cursor !== null);

    return {
      items: timelinePagesItemsForTurn(pages, turnId),
      complete: foundTurnStart,
      pages,
    };
  }

  async recoverLatestTurnTail(
    host: HostRecord,
    threadId: string,
    turnId: string,
  ): Promise<RecoveredTurnTail> {
    this.requireSnapshot(host.id, threadId);
    const latestPage = await this.fetchTimelinePage(host, threadId, null);
    const tailItems: ThreadTimelineItem[] = timelinePageItemsForTurn(latestPage, turnId);
    const complete = latestPage.data.some(
      (entry) => entry.type === "turnStarted" && entry.turnId === turnId,
    );

    return {
      turnId,
      olderUserItems: [],
      tailItems,
      complete,
    };
  }

  private async fetchTimelinePage(
    host: HostRecord,
    threadId: string,
    cursor: string | null,
    limit = DEFAULT_TIMELINE_PAGE_LIMIT,
  ) {
    const cached = threadTimelinePageStore.get(host.id, threadId, cursor, limit);
    if (cached !== null) return cached;
    const client = await this.registry.getHostClient(host);
    const page = await client.request(
      "thread/timeline/list",
      { threadId, cursor, limit },
      120_000,
      parseThreadTimelinePage,
    );
    threadTimelinePageStore.set(host.id, threadId, cursor, limit, page);
    return page;
  }

  private requireSnapshot(hostId: number, threadId: string) {
    const snapshot = threadSnapshotStore.get(hostId, threadId);
    if (snapshot === null) throw new Error("Thread snapshot is unavailable while paging history");
    return snapshot;
  }
}

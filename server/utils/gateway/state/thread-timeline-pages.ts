import type { AppServerTimelinePage } from "~~/shared/runtime/app-server";
import { currentGatewayUserId } from "./memory";

const MAX_CACHED_PAGES_PER_THREAD = 16;

interface CachedPage {
  key: string;
  page: AppServerTimelinePage;
  updatedAt: number;
}

const pages = new Map<string, CachedPage>();

export const threadTimelinePageStore = {
  get(hostId: number, threadId: string, cursor: string | null, limit: number) {
    if (cursor === null) return null;
    const entry = pages.get(cacheKey(hostId, threadId, cursor, limit));
    if (entry === undefined) return null;
    entry.updatedAt = Date.now();
    return entry.page;
  },

  set(
    hostId: number,
    threadId: string,
    cursor: string | null,
    limit: number,
    page: AppServerTimelinePage,
  ) {
    if (cursor === null) return;
    const key = cacheKey(hostId, threadId, cursor, limit);
    pages.set(key, { key, page, updatedAt: Date.now() });
    prune(hostId, threadId);
  },

  deleteForHost(hostId: number) {
    const prefix = `${scopePrefix()}:${hostId}:`;
    for (const key of pages.keys()) {
      if (key.startsWith(prefix)) pages.delete(key);
    }
  },
};

function prune(hostId: number, threadId: string) {
  const prefix = `${scopePrefix()}:${hostId}:${threadId}:`;
  const entries = [...pages.values()]
    .filter((entry) => entry.key.startsWith(prefix))
    .sort((left, right) => left.updatedAt - right.updatedAt);
  for (const entry of entries.slice(0, Math.max(0, entries.length - MAX_CACHED_PAGES_PER_THREAD))) {
    pages.delete(entry.key);
  }
}

function cacheKey(hostId: number, threadId: string, cursor: string, limit: number) {
  return `${scopePrefix()}:${hostId}:${threadId}:${limit}:${cursor}`;
}

function scopePrefix() {
  const userId = currentGatewayUserId();
  if (userId === null) throw new Error("Timeline page cache requires an authenticated user scope");
  return String(userId);
}

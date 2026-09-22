import type { AgentEvent } from "~~/shared/agent/events";
import type { AppServerThread, ThreadHistoryItem } from "~~/shared/types";
import {
  isAppServerSubAgentThread,
  threadHistoryItemFromUnknown,
} from "~~/shared/runtime/app-server";
import { trimmedOrNull } from "~~/shared/utils/strings";
import { currentGatewayMemoryState, nowIso } from "./memory";

export const subAgentThreadStore = {
  pruneToHosts(hostIds: Set<number>) {
    currentGatewayMemoryState().subAgentThreads =
      currentGatewayMemoryState().subAgentThreads.filter((thread) => hostIds.has(thread.hostId));
  },

  deleteForHost(hostId: number) {
    currentGatewayMemoryState().subAgentThreads =
      currentGatewayMemoryState().subAgentThreads.filter((thread) => thread.hostId !== hostId);
  },

  record(hostId: number, threadId: string, parentThreadId: string | null = null) {
    const normalizedThreadId = threadId.trim();
    if (normalizedThreadId === "") {
      return;
    }
    const updatedAt = nowIso();
    const index = currentGatewayMemoryState().subAgentThreads.findIndex(
      (thread) => thread.hostId === hostId && thread.threadId === normalizedThreadId,
    );
    if (index >= 0) {
      const existing = currentGatewayMemoryState().subAgentThreads[index];
      if (existing === undefined) {
        return;
      }
      currentGatewayMemoryState().subAgentThreads[index] = {
        ...existing,
        parentThreadId: parentThreadId ?? existing.parentThreadId,
        updatedAt,
      };
      return;
    }
    currentGatewayMemoryState().subAgentThreads.push({
      hostId,
      threadId: normalizedThreadId,
      parentThreadId,
      updatedAt,
    });
  },

  recordThreadMetadata(hostId: number, thread: AppServerThread) {
    if (!isSubAgentThreadMetadata(thread)) {
      return;
    }
    this.record(hostId, String(thread.id), parentThreadIdFromMetadata(thread));
  },

  recordRuntimeEvent(hostId: number, parentThreadId: string, event: AgentEvent) {
    for (const threadId of subAgentThreadIdsFromEvent(event)) {
      this.record(hostId, threadId, parentThreadId);
    }
  },

  isSubAgentThread(hostId: number, threadId: string) {
    return currentGatewayMemoryState().subAgentThreads.some(
      (thread) => thread.hostId === hostId && thread.threadId === threadId,
    );
  },
};

function isSubAgentThreadMetadata(thread: AppServerThread) {
  return isAppServerSubAgentThread(thread);
}

export function parentThreadIdFromMetadata(thread: AppServerThread) {
  const parentThreadId = thread.parentThreadId;
  return typeof parentThreadId === "string" ? trimmedOrNull(parentThreadId) : null;
}

function subAgentThreadIdsFromEvent(event: AgentEvent) {
  // Sub-agent activity arrives as pre-built timeline items (item/started |
  // item/completed in the Codex feed; both map to timeline.item.upsert).
  if (event.type !== "timeline.item.upsert") {
    return [];
  }
  const item = threadHistoryItemFromUnknown(event.item);
  return item === null ? [] : subAgentThreadIdsFromItem(item);
}

function subAgentThreadIdsFromItem(item: ThreadHistoryItem) {
  if (item.type !== "subAgentActivity") {
    return [];
  }
  return typeof item.agentThreadId === "string" && item.agentThreadId.trim() !== ""
    ? [item.agentThreadId.trim()]
    : [];
}

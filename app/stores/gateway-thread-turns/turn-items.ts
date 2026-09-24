import { TIMELINE_PAGE_LIMIT } from "~~/shared/config";
import { mergeTurnItems } from "~~/shared/thread-history/item-merge";
import { timelinePagesItemsForTurn } from "~~/shared/thread-history/app-server-timeline";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { patchThreadView } from "@/stores/gateway/thread-open/thread-view-cache";
import {
  errorMessageLabels,
  messageFromError,
  pinnedKey,
} from "@/stores/gateway/thread-utils/identity";
import { captureSessionEpoch } from "@/utils/session-epoch";
import { requestThreadTimelinePage } from "./transport";
import type { Translate } from "./types";
import type { AppServerTimelinePage } from "~~/shared/runtime/app-server";

export async function loadTurnItems(t: Translate, turnId: string) {
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  const turns = useGatewayThreadTurnsStore();
  const hostId = navigation.selectedHostId;
  const threadId = navigation.selectedThreadId;
  if (hostId === null || threadId === null) return false;

  const turn = views.history?.thread.turns.find((candidate) => candidate.id === turnId);
  if (turn === undefined || turn.itemsView === "full") return true;
  const loadingKey = turns.turnItemsKey(hostId, threadId, turnId);
  if (turns.loadingTurnItemsByKey[loadingKey] === true) return false;

  const sessionIsCurrent = captureSessionEpoch();
  turns.setTurnItemsLoading(hostId, threadId, turnId, true);
  try {
    const pages: AppServerTimelinePage[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let reachedTurnStart = false;
    do {
      const page = await requestThreadTimelinePage({
        hostId,
        threadId,
        cursor,
        limit: TIMELINE_PAGE_LIMIT,
      });
      pages.push(page);
      reachedTurnStart = page.data.some(
        (entry) => entry.type === "turnStarted" && entry.turnId === turnId,
      );
      cursor = reachedTurnStart ? null : page.nextCursor;
      if (cursor !== null) {
        if (seenCursors.has(cursor)) {
          throw new Error("App Server returned a repeated thread item cursor");
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== null);

    const items = timelinePagesItemsForTurn(pages, turnId);

    if (!sessionIsCurrent()) return false;
    const view = views.threadViews[pinnedKey(hostId, threadId)];
    const history = view?.history;
    if (history === null || history === undefined) return false;
    const nextTurns = history.thread.turns.map((candidate) =>
      String(candidate.id) === turnId
        ? {
            ...candidate,
            items: mergeTurnItems(items, candidate.items ?? []),
            itemsView: reachedTurnStart ? ("full" as const) : candidate.itemsView,
          }
        : candidate,
    );
    // Publish only the complete item sequence. Inserting each page would temporarily move the
    // final answer and force several virtualizer remeasurements for one disclosure action.
    patchThreadView(hostId, threadId, {
      history: { thread: { ...history.thread, turns: nextTurns } },
    });
    return true;
  } catch (error: unknown) {
    if (sessionIsCurrent()) {
      useGatewayBootstrapStore().setError(
        messageFromError(error, t("app.loadTurnItemsFailed"), errorMessageLabels(t)),
        { hostId, threadId, turnId },
      );
    }
    return false;
  } finally {
    turns.setTurnItemsLoading(hostId, threadId, turnId, false);
  }
}

import {
  insertSteerItemIntoActiveTurn,
  mergeItemIntoLatestTurn,
} from "~~/shared/thread-history/items";
import { mergeThreadTurns } from "~~/shared/thread-history/turns";
import type {
  ThreadHistoryItem,
  ThreadHistorySeed,
  ThreadHistoryState,
  ThreadHistoryTurn,
} from "~~/shared/thread-history/types";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { cacheSelectedThreadView } from "@/stores/gateway/thread-open/view-state";
import {
  patchThreadView,
  setSelectedThreadHistory,
} from "@/stores/gateway/thread-open/thread-view-cache";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";

export function insertOptimisticSteerMessage(
  threadId: string,
  turnId: string,
  clientUserMessageId: string,
  content: unknown[],
) {
  const views = useGatewayThreadViewStore();
  setSelectedThreadHistory(
    insertSteerItemIntoActiveTurn(views.history, views.currentThread, threadId, turnId, {
      type: "userMessage",
      id: clientUserMessageId,
      clientId: clientUserMessageId,
      turnId,
      content,
    }),
  );
  cacheSelectedThreadView();
}

export function insertOptimisticNewTurnMessage(
  threadId: string,
  clientUserMessageId: string,
  content: unknown[],
) {
  const views = useGatewayThreadViewStore();
  setSelectedThreadHistory(
    mergeItemIntoLatestTurn(views.history, views.currentThread, threadId, {
      type: "userMessage",
      id: clientUserMessageId,
      clientId: clientUserMessageId,
      content,
    }),
  );
  cacheSelectedThreadView();
}

export function acceptStartedTurn(
  threadId: string,
  turn: ThreadHistoryTurn,
  clientUserMessageId: string,
  content: unknown[],
) {
  const views = useGatewayThreadViewStore();
  let history = mergeThreadTurns(views.history, views.currentThread, threadId, [turn], "append");
  // turn/start returns the authoritative Turn before item/started is guaranteed to arrive. Move
  // the optimistic message into that Turn in the same store publication; publishing the appended
  // official Turn first leaves one Vue render where both it and the client-* Turn are visible.
  history = mergeItemIntoLatestTurn(history, views.currentThread, threadId, {
    type: "userMessage",
    id: clientUserMessageId,
    clientId: clientUserMessageId,
    turnId: turn.id,
    content,
  });
  setSelectedThreadHistory(history);
  cacheSelectedThreadView();
}

export function upsertHistoryItem(hostId: number, threadId: string, item: ThreadHistoryItem) {
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  const update = (history: ThreadHistoryState | null, currentThread: ThreadHistorySeed | null) =>
    mergeItemIntoLatestTurn(history, currentThread, threadId, item);
  if (navigation.selectedHostId === hostId && navigation.selectedThreadId === threadId) {
    setSelectedThreadHistory(update(views.history, views.currentThread));
    cacheSelectedThreadView();
    return;
  }
  const key = pinnedKey(hostId, threadId);
  const view = views.threadViews[key];
  if (view) {
    // Background subscriptions can mutate a thread while another route is selected. Use the same
    // cache boundary as batched realtime events so the projected history remains atomic; direct
    // assignment here previously left the projection stale until a full page refresh.
    patchThreadView(hostId, threadId, {
      history: update(view.history, view.currentThread),
    });
  }
}

export function historyForThread(hostId: number, threadId: string) {
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  if (navigation.selectedHostId === hostId && navigation.selectedThreadId === threadId) {
    return views.history;
  }
  return views.threadViews[pinnedKey(hostId, threadId)]?.history ?? null;
}

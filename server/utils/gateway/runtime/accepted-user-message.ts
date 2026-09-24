import { gatewayEventStore } from "../state/gateway-events";
import { threadSnapshotStore } from "../state/thread-snapshots";
import { threadRuntimeEvents } from "./thread-runtime-events";
import { recordFromUnknown } from "~~/shared/utils/records";

export function recordAcceptedUserMessage(input: {
  hostId: number;
  threadId: string;
  turnId: string;
  clientUserMessageId: string;
  content: Record<string, unknown>[];
}) {
  if (acceptedUserMessageAlreadyRecorded(input)) return;

  // App Server persists accepted turn/start and turn/steer input before it necessarily emits the
  // matching user-message lifecycle item. The submitting browser has an optimistic row, but every
  // other subscribed browser would otherwise remain stale until that lifecycle event or an
  // explicit history request. Publish the successful command at this server boundary so
  // all peers and the snapshot cache reduce the same canonical item immediately. The eventual
  // provider item carries the same clientId and therefore replaces this provisional id in the
  // shared reducer instead of creating a duplicate.
  threadRuntimeEvents.record(input.hostId, input.threadId, {
    type: "timeline.item.upsert",
    item: {
      type: "userMessage",
      id: input.clientUserMessageId,
      clientId: input.clientUserMessageId,
      turnId: input.turnId,
      content: input.content,
    },
  });
}

function acceptedUserMessageAlreadyRecorded(input: {
  hostId: number;
  threadId: string;
  clientUserMessageId: string;
}) {
  const snapshot = threadSnapshotStore.get(input.hostId, input.threadId);
  if (
    snapshot?.history.thread.turns.some((turn) =>
      turn.items?.some((item) => item.clientId === input.clientUserMessageId),
    ) === true
  ) {
    return true;
  }

  // Notifications can win the RPC-response race before a snapshot exists. Check the bounded event
  // replay buffer as well so a late command acknowledgement never overwrites the provider item.
  return gatewayEventStore.list(input.hostId, input.threadId, 0, 500).some((event) => {
    if (event.event.type !== "timeline.item.upsert") return false;
    return recordFromUnknown(event.event.item)?.clientId === input.clientUserMessageId;
  });
}

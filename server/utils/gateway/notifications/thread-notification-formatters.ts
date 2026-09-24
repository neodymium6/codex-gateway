import type { GatewayEvent, ThreadGoalStatus, ThreadRuntimeStatus } from "~~/shared/types";
import { terminalTurnStatus } from "~~/shared/thread-runtime-status";
import { currentGatewayMemoryState } from "../state/memory";
import { hostStore } from "../state/hosts";
import type { ServerNotification } from "~~/shared/types";
import { threadGoalFromUnknown, threadHistoryTurnFromUnknown } from "~~/shared/runtime/app-server";
import { idFromUnknown, recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { firstNonEmptyString } from "~~/shared/utils/strings";
import { serverText } from "./locale";

export function threadTurnCompletedNotification(event: GatewayEvent): ServerNotification | null {
  const canonicalEvent = event.event;
  if (canonicalEvent.type !== "turn.completed") return null;
  const turn = threadHistoryTurnFromUnknown(canonicalEvent.turn) ?? {};
  const turnId = turn.id === null || turn.id === undefined ? `event-${event.id}` : String(turn.id);
  const status = terminalTurnStatus(turn.status);
  return {
    key: `thread-terminal:${event.hostId}:${event.threadId}:turn:${turnId}:${status}`,
    category: "turnCompleted",
    title: `${threadTitle(event.hostId, event.threadId)} · ${serverText("Turn finished", "回合已结束")}`,
    body: serverText(
      `Session on ${hostTitle(event.hostId)}: ${turnStatusLabel(status)}. Ready for your next message.`,
      `${hostTitle(event.hostId)} 上的会话状态：${turnStatusLabel(status)}。可以继续输入下一步。`,
    ),
    group: "Codex Gateway",
    target: notificationTarget(event),
  };
}

export function threadGoalCompletedNotification(event: GatewayEvent): ServerNotification | null {
  const canonicalEvent = event.event;
  if (canonicalEvent.type !== "thread.goal.updated") return null;
  const goal = threadGoalFromUnknown(canonicalEvent.goal);
  if (goal === null || !isTerminalGoalStatus(goal.status)) {
    return null;
  }
  return {
    key: `thread-goal:${event.hostId}:${event.threadId}:${goal.status}:${goal.updatedAt}`,
    category: "goalCompleted",
    title: `${threadTitle(event.hostId, event.threadId)} · ${serverText("Goal finished", "目标已结束")}`,
    body: serverText(
      `Goal on ${hostTitle(event.hostId)}: ${goalStatusLabel(goal.status)}. Elapsed ${formatDuration(goal.timeUsedSeconds)}, used ${goal.tokensUsed.toLocaleString("en-US")} tokens.`,
      `${hostTitle(event.hostId)} 上的目标状态：${goalStatusLabel(goal.status)}。推进 ${formatDuration(goal.timeUsedSeconds)}，使用 ${goal.tokensUsed.toLocaleString("zh-CN")} tokens。`,
    ),
    group: "Codex Gateway",
    target: notificationTarget(event),
  };
}

export function threadUserInputRequestedNotification(event: GatewayEvent): ServerNotification {
  const canonicalEvent = event.event;
  if (canonicalEvent.type !== "serverRequest.requested") {
    // Fallback: return a generic notification
    return {
      key: `thread-user-input:${event.hostId}:${event.threadId}:${event.id}`,
      category: "userInputRequested",
      title: `${threadTitle(event.hostId, event.threadId)} · ${serverText("Waiting for your answer", "等待回答")}`,
      body: serverText(
        `The agent on ${hostTitle(event.hostId)} is waiting for your answer. Open the conversation to view the question.`,
        `${hostTitle(event.hostId)} 上的 Agent 正在等待你的回答。请打开会话查看问题。`,
      ),
      group: "Codex Gateway",
      target: notificationTarget(event),
    };
  }
  const params = recordFromUnknown(canonicalEvent.item.params) ?? {};
  const questions = Array.isArray(params?.questions) ? params.questions : [];
  const firstQuestion = recordFromUnknown(questions[0]);
  const question = firstNonEmptyString([
    stringFromUnknown(firstQuestion?.question),
    stringFromUnknown(firstQuestion?.header),
  ]);
  const requestId = idFromUnknown(params?.itemId) ?? canonicalEvent.requestId ?? event.id;
  const questionCount =
    questions.length > 1
      ? serverText(` (${questions.length} questions)`, `（共 ${questions.length} 个问题）`)
      : "";
  const prompt =
    question ?? serverText("Open the conversation to view the question.", "请打开会话查看问题。");

  return {
    key: `thread-user-input:${event.hostId}:${event.threadId}:${requestId}`,
    category: "userInputRequested",
    title: `${threadTitle(event.hostId, event.threadId)} · ${serverText("Waiting for your answer", "等待回答")}`,
    body: serverText(
      `The agent on ${hostTitle(event.hostId)} is waiting for your answer${questionCount}: ${prompt}`,
      `${hostTitle(event.hostId)} 上的 Agent 正在等待你的回答${questionCount}：${prompt}`,
    ),
    group: "Codex Gateway",
    target: notificationTarget(event),
  };
}

export function isTerminalGoalStatus(status: ThreadGoalStatus) {
  return status !== "active" && status !== "paused";
}

function notificationTarget(event: GatewayEvent) {
  const pinnedThread = currentGatewayMemoryState().pinnedThreads.find(
    (thread) => thread.hostId === event.hostId && thread.threadId === event.threadId,
  );
  const metadata = currentGatewayMemoryState().threadMetadata.find(
    (thread) => thread.hostId === event.hostId && thread.threadId === event.threadId,
  );
  return {
    kind: "thread" as const,
    hostId: event.hostId,
    projectId: pinnedThread?.projectId ?? metadata?.projectId ?? null,
    threadId: event.threadId,
  };
}

function threadTitle(hostId: number, threadId: string) {
  const pinnedThread = currentGatewayMemoryState().pinnedThreads.find(
    (thread) => thread.hostId === hostId && thread.threadId === threadId,
  );
  const metadata = currentGatewayMemoryState().threadMetadata.find(
    (thread) => thread.hostId === hostId && thread.threadId === threadId,
  );
  return (
    firstNonEmptyString([
      pinnedThread?.title,
      metadata?.title,
      metadata?.name,
      metadata?.preview,
    ]) ?? threadId
  );
}

function hostTitle(hostId: number) {
  return firstNonEmptyString([hostStore.get(hostId)?.name]) ?? `Host ${hostId}`;
}

function turnStatusLabel(status: ThreadRuntimeStatus) {
  const labels: Record<ThreadRuntimeStatus, string> = {
    idle: serverText("idle", "空闲"),
    running: serverText("running", "运行中"),
    completed: serverText("completed", "已完成"),
    failed: serverText("failed", "失败"),
    interrupted: serverText("interrupted", "已中断"),
  };
  return labels[status];
}

function goalStatusLabel(status: ThreadGoalStatus) {
  const labels: Record<ThreadGoalStatus, string> = {
    active: serverText("active", "推进中"),
    paused: serverText("paused", "已暂停"),
    blocked: serverText("blocked", "已阻塞"),
    usageLimited: serverText("usage limited", "用量受限"),
    budgetLimited: serverText("budget exhausted", "预算已用尽"),
    complete: serverText("completed", "已完成"),
  };
  return labels[status];
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  if (minutes <= 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

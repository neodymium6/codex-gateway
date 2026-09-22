import type { AgentProviderId } from "~~/shared/types";

export type HostRuntimeKey = `${number}:${number}:${AgentProviderId}`;
export type ThreadRuntimeKey = `${HostRuntimeKey}:${string}`;

export function hostRuntimeKey(
  userId: number,
  hostId: number,
  providerId: AgentProviderId,
): HostRuntimeKey {
  return `${userId}:${hostId}:${providerId}`;
}

export function hostRuntimePrefix(userId: number, hostId: number) {
  return `${userId}:${hostId}:` as const;
}

export function threadRuntimeKey(
  userId: number,
  hostId: number,
  providerId: AgentProviderId,
  threadId: string,
): ThreadRuntimeKey {
  return `${hostRuntimeKey(userId, hostId, providerId)}:${threadId}`;
}

export function threadRuntimePrefix(userId: number, hostId: number, providerId: AgentProviderId) {
  return `${hostRuntimeKey(userId, hostId, providerId)}:` as const;
}

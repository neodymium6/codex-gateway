import type { HostRecord, ProjectRecord } from "./records";

export interface PinnedThreadRecord {
  hostId: number;
  projectId: number | null;
  threadId: string;
  title: string;
  subtitle?: string | null;
  projectName?: string | null;
  updatedAt?: number | null;
}

export interface BarkNotificationSettings {
  enabled: boolean;
  serverUrl: string;
  deviceKey: string;
  group?: string | null;
}

export interface GatewayNotificationSettings {
  browser: BrowserNotificationSettings;
  bark: BarkNotificationSettings;
}

export interface BrowserNotificationSettings {
  turnCompleted: boolean;
  goalCompleted: boolean;
  userInputRequested: boolean;
  tmuxCompleted: boolean;
  hostLifecycle: boolean;
}

export interface GatewayConfig {
  version: 1;
  hosts: HostRecord[];
  projects: ProjectRecord[];
  pinnedThreads: PinnedThreadRecord[];
  notifications: GatewayNotificationSettings;
}

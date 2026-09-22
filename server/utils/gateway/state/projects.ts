import type { ProjectCreateInput, ProjectRecord, ProjectUpdateInput } from "~~/shared/types";
import { currentGatewayMemoryState, nextId, nowIso } from "./memory";

function normalizeProject(
  input: ProjectCreateInput,
  id = nextId(currentGatewayMemoryState().projects),
) {
  const timestamp = nowIso();
  const existing = currentGatewayMemoryState().projects.find((project) => project.id === id);
  return {
    id,
    hostId: input.hostId,
    name: input.name.trim(),
    remotePath: input.remotePath.trim(),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

export const projectStore = {
  replaceProjects(projects: ProjectRecord[]) {
    currentGatewayMemoryState().projects = projects.map((project) => ({
      ...project,
      name: project.name.trim(),
      remotePath: project.remotePath.trim(),
    }));
    currentGatewayMemoryState().configuredProjectIds = new Set(
      projects.map((project) => project.id),
    );
  },

  pruneToHosts(hostIds: Set<number>) {
    currentGatewayMemoryState().projects = currentGatewayMemoryState().projects.filter((project) =>
      hostIds.has(project.hostId),
    );
    pruneConfiguredProjectIds();
  },

  deleteForHost(hostId: number) {
    currentGatewayMemoryState().projects = currentGatewayMemoryState().projects.filter(
      (project) => project.hostId !== hostId,
    );
    pruneConfiguredProjectIds();
  },

  delete(id: number) {
    const existing = this.get(id);
    if (existing === null) {
      return null;
    }
    currentGatewayMemoryState().projects = currentGatewayMemoryState().projects.filter(
      (project) => project.id !== id,
    );
    currentGatewayMemoryState().configuredProjectIds.delete(id);
    return existing;
  },

  list(hostId?: number): ProjectRecord[] {
    return currentGatewayMemoryState()
      .projects.filter((project) => hostId === undefined || project.hostId === hostId)
      .sort((left, right) => left.name.localeCompare(right.name));
  },

  listConfigured(): ProjectRecord[] {
    return this.list().filter((project) =>
      currentGatewayMemoryState().configuredProjectIds.has(project.id),
    );
  },

  get(id: number): ProjectRecord | null {
    return currentGatewayMemoryState().projects.find((project) => project.id === id) ?? null;
  },

  create(input: ProjectCreateInput): ProjectRecord {
    const project = upsertProject(input);
    currentGatewayMemoryState().configuredProjectIds.add(project.id);
    return project;
  },

  update(id: number, input: ProjectUpdateInput): ProjectRecord | null {
    const existing = this.get(id);
    if (existing === null) {
      return null;
    }
    const project = normalizeProject(input, id);
    currentGatewayMemoryState().projects = currentGatewayMemoryState().projects.map((item) =>
      item.id === id ? project : item,
    );
    currentGatewayMemoryState().configuredProjectIds.add(id);
    return project;
  },

  ensureForPath(hostId: number, remotePath: string): ProjectRecord {
    const normalizedPath = remotePath.trim();
    const existing = currentGatewayMemoryState().projects.find(
      (project) => project.hostId === hostId && project.remotePath === normalizedPath,
    );
    if (existing !== undefined) {
      return existing;
    }
    const name =
      normalizedPath
        .split("/")
        .filter((part) => part !== "")
        .at(-1) ?? (normalizedPath === "" ? "root" : normalizedPath);
    // Thread discovery needs a runtime grouping record, not a persisted user project.
    return upsertProject({ hostId, name, remotePath: normalizedPath });
  },

  count() {
    return currentGatewayMemoryState().projects.length;
  },
};

function upsertProject(input: ProjectCreateInput): ProjectRecord {
  const remotePath = input.remotePath.trim();
  const existing = currentGatewayMemoryState().projects.find(
    (project) => project.hostId === input.hostId && project.remotePath === remotePath,
  );
  const project = normalizeProject(input, existing?.id);
  if (existing !== undefined) {
    currentGatewayMemoryState().projects = currentGatewayMemoryState().projects.map((item) =>
      item.id === existing.id ? project : item,
    );
  } else {
    currentGatewayMemoryState().projects.push(project);
  }
  return project;
}

function pruneConfiguredProjectIds() {
  const retainedIds = new Set(currentGatewayMemoryState().projects.map((project) => project.id));
  currentGatewayMemoryState().configuredProjectIds = new Set(
    [...currentGatewayMemoryState().configuredProjectIds].filter((id) => retainedIds.has(id)),
  );
}

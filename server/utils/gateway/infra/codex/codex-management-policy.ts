import type { HostWithSecret } from "../ssh/ssh-types";
import { hostStore } from "../../state/hosts";

// A managed connection may still be awaiting I/O when its host is changed or deleted.
export function assertCodexManagementAllowed(host: HostWithSecret) {
  const current = hostStore.getWithSecret(host.id);
  if (!current || host.codexRuntimeMode === "external" || current.codexRuntimeMode === "external") {
    throw new Error("Codex runtime management is disabled for this host.");
  }
}

// Reinstallation is destructive and bandwidth-heavy, so only classify failures that prove the
// managed executable or standalone archive is absent. Legacy npm error strings remain recognized
// so hosts created before the standalone migration can recover once and move to the new layout.
// Socket and transport errors describe app-server startup/connectivity, not a corrupt installation.
export function isRecoverableCodexInstallError(error: unknown) {
  const message = messageFromError(error);
  return /codex executable not found|Missing optional dependency @openai\/codex-|Cannot find module .*@openai\/codex-|Codex standalone archive is missing|Standalone Codex installation produced unexpected version/i.test(
    message,
  );
}

function messageFromError(error: unknown) {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return [error.message, cause instanceof Error ? cause.message : null]
      .filter(Boolean)
      .join("\n");
  }
  return String(error);
}

// This is the single version gate shared by remote install, upgrade and RPC client metadata.
export const SUPPORTED_CODEX_VERSION = "0.156.1";

export interface ParsedCodexVersion {
  raw: string;
  version: string;
}

// The app-server's originator can be a desktop/remote client, not codex_cli_rs.
// Only the leading product version identifies the running server; later tokens
// can contain the connecting client's (newer) version.
export function parseAppServerVersion(output: string): ParsedCodexVersion | null {
  const raw = output.trim();
  const match = raw.match(/^[A-Za-z0-9_.-]+\/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\s|$)/);
  const version = match?.[1];
  return version === undefined ? null : { raw, version };
}

export function parseCodexVersion(output: string): ParsedCodexVersion | null {
  const raw = output.trim();
  const match = raw.match(
    /\b(?:codex-cli|codex_cli_rs|codex-tui|codex_app_server|Codex Desktop)[ /](\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/i,
  );
  if (match === null) {
    return null;
  }
  const version = match[1];
  if (version === undefined) {
    return null;
  }
  return {
    raw,
    version,
  };
}

export function compareSemver(left: string, right: string) {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);
  for (const index of [0, 1, 2] as const) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function isCodexVersionAtLeast(version: string, minimum: string) {
  return compareSemver(version, minimum) >= 0;
}

function semverParts(version: string): [number, number, number] {
  const parsed = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!parsed) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  const [, major, minor, patch] = parsed;
  if (major == null || minor == null || patch == null) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  return [Number(major), Number(minor), Number(patch)];
}

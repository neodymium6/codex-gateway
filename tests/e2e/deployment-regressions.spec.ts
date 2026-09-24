import { expect, test } from "@playwright/test";
import { parseAppServerVersion } from "../../server/utils/gateway/infra/codex/codex-version";
import { trustedNetworkConfig } from "../../server/utils/gateway/auth/trusted-network";
import { HostMetricsRemoteParser } from "../../server/utils/gateway/host-metrics/remote-parser";
import { hostMetricsRemoteCommand } from "../../server/utils/gateway/host-metrics/remote-command";
import { buildHostMetricsSample } from "../../server/utils/gateway/host-metrics/sample-builder";
import { execRemoteSsh, readRemoteEnv } from "./helpers/remote-codex";

test("server version is the leading product, never the connecting client's version", () => {
  expect(
    parseAppServerVersion("codex_chatgpt_ios_remote/0.153.4 (Linux) unknown (codex-tui; 0.156.1)")
      ?.version,
  ).toBe("0.153.4");
  expect(parseAppServerVersion("codex_cli_rs/0.156.1 (Linux)")?.version).toBe("0.156.1");
  expect(parseAppServerVersion("unknown (codex-tui/0.156.1)")).toBeNull();
  expect(parseAppServerVersion("")).toBeNull();
});

test("trusted authentication is opt-in and rejects incomplete or ambiguous configuration", () => {
  expect(trustedNetworkConfig({})).toBeNull();
  expect(() => trustedNetworkConfig({ CODEX_GATEWAY_AUTH_MODE: "trust" })).toThrow();
  const env = {
    CODEX_GATEWAY_AUTH_MODE: "trusted-network",
    CODEX_GATEWAY_TRUSTED_USER: "E2E",
    CODEX_GATEWAY_TRUSTED_ORIGINS: "https://gateway.example.test",
  };
  expect(trustedNetworkConfig(env)?.username).toBe("e2e");
  for (const origin of [
    "",
    "*",
    "null",
    "https://gateway.example.test/path",
    "https://user@gateway.example.test",
    "ftp://gateway.example.test",
  ]) {
    expect(() => trustedNetworkConfig({ ...env, CODEX_GATEWAY_TRUSTED_ORIGINS: origin })).toThrow();
  }
  expect(() => trustedNetworkConfig({ ...env, CODEX_GATEWAY_TRUSTED_USER: "" })).toThrow();
});

test("metrics parser rejects nanosecond timestamps before sample building", () => {
  for (const value of ["1790250078208496626", "NaN", "Infinity", "8640000000000001"]) {
    expect(() => new HostMetricsRemoteParser().push(`@@BEGIN\t${value}\n`)).toThrow(
      "Invalid host metrics timestamp",
    );
  }
});

test("real SSH metrics produce valid dates and counters", async () => {
  const remote = { ...(await readRemoteEnv()), host: "ssh-target-external" };
  const result = await execRemoteSsh(remote, hostMetricsRemoteCommand(false));
  const samples = new HostMetricsRemoteParser().push(result.stdout);
  expect(samples).toHaveLength(1);
  const sample = buildHostMetricsSample(samples[0]!, null);
  expect(Math.abs(Date.parse(sample.sampledAt) - Date.now())).toBeLessThan(60_000);
  expect(sample.memory.totalBytes).toBeGreaterThan(0);
});

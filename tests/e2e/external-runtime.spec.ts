import { z } from "zod";
import { expect, test } from "./fixtures/remote-workspace";
import { authenticatedFetch, openApp, resetGatewayConfig } from "./helpers/app";
import { hostRecordSchema } from "./helpers/http-schemas";
import {
  addRemoteHost,
  execRemoteSsh,
  readRemoteEnv,
  resetRemoteAppServer,
} from "./helpers/remote-codex";
import { hostBaseSchema } from "../../server/utils/gateway/http/validation/hosts-projects";
import {
  codexRemoteAppServerVerifyPayload,
  codexRemoteAppServerExistingProxyPayload,
} from "../../server/utils/gateway/infra/ssh/remote-command";

test("runtime mode defaults to managed and rejects unknown values", () => {
  const input = { name: "fixture", sshHost: "fixture.invalid" };
  expect(hostBaseSchema.parse(input).codexRuntimeMode).toBe("managed");
  expect(hostBaseSchema.parse({ ...input, codexRuntimeMode: "external" }).codexRuntimeMode).toBe(
    "external",
  );
  expect(hostBaseSchema.safeParse({ ...input, codexRuntimeMode: "externl" }).success).toBe(false);
});

test("external SSH payloads do not configure or bootstrap Codex", () => {
  const verify = codexRemoteAppServerVerifyPayload({ configure: false });
  const connect = codexRemoteAppServerExistingProxyPayload();
  for (const payload of [verify, connect]) {
    expect(payload).not.toMatch(
      /config\.toml|apply_patch_streaming_events|daemon bootstrap|kill -TERM|mkdir|rm -f/,
    );
  }
  expect(connect).toContain('"$CODEX_BIN" app-server proxy');
  expect(codexRemoteAppServerVerifyPayload()).toContain("apply_patch_streaming_events");
});

test("external runtime preserves a real non-managed server and fails closed when stopped", async ({
  page,
}) => {
  const remote = { ...(await readRemoteEnv()), host: "ssh-target-external" };
  await openApp(page);
  await resetRemoteAppServer(remote);
  // This dedicated fixture never receives the operator's auth or configuration.
  await execRemoteSsh(
    remote,
    `set -eu
mkdir -p "$HOME/.codex"
printf '%s\\n' '[features]' 'apply_patch_streaming_events = false' 'background_paginated_rollout_migration = false' > "$HOME/.codex/config.toml"
`,
  );
  const state = async () =>
    (
      await execRemoteSsh(
        remote,
        `set -eu
sha256sum "$HOME/.codex/config.toml"
readlink /usr/local/bin/codex
test ! -e "$HOME/.codex/packages/standalone"
test ! -e "$HOME/.local/bin/codex"
test ! -e "$HOME/.cache/codex-gateway/upgrades"
`,
      )
    ).stdout;
  const start = async () => {
    await execRemoteSsh(
      remote,
      `nohup /opt/codex-standalone/bin/codex app-server --listen unix:// > /tmp/external-app-server.log 2>&1 < /dev/null & echo $! > /tmp/external-app-server.pid`,
    );
    await expect
      .poll(async () =>
        (
          await execRemoteSsh(
            remote,
            'if test -S "$HOME/.codex/app-server-control/app-server-control.sock"; then echo ready; else echo waiting; fi',
          )
        ).stdout.trim(),
      )
      .toBe("ready");
  };
  let hostId: number | null = null;
  try {
    await start();
    const before = await state();
    const pid = (await execRemoteSsh(remote, "cat /tmp/external-app-server.pid")).stdout.trim();
    const host = await addRemoteHost(page, remote, "external-runtime", {
      codexRuntimeMode: "external",
      waitForConnection: false,
    });
    hostId = host.id;
    const verify = () =>
      authenticatedFetch(
        page,
        {
          url: "/api/e2e/external-runtime",
          method: "POST",
          body: { hostId },
        },
        (value) =>
          z
            .object({
              ok: z.boolean(),
              upgraded: z.boolean().optional(),
              message: z.string().optional(),
            })
            .parse(value),
      );
    await expect.poll(async () => (await verify()).ok).toBe(true);
    expect((await verify()).upgraded).toBe(false);
    expect(await state()).toBe(before);
    expect(
      (await execRemoteSsh(remote, `kill -0 ${Number(pid)} && echo alive`)).stdout.trim(),
    ).toBe("alive");
    const exported = await authenticatedFetch(page, { url: "/api/config/export" }, (value) =>
      z
        .object({ hosts: z.array(hostRecordSchema) })
        .loose()
        .parse(value),
    );
    expect(exported.hosts.find((item) => item.id === hostId)?.codexRuntimeMode).toBe("external");
    await authenticatedFetch(
      page,
      { url: "/api/config/sync", method: "POST", body: exported },
      () => undefined,
    );
    await resetRemoteAppServer(remote);
    await expect.poll(async () => (await verify()).message).toContain("not running");
    expect(await state()).toBe(before);
    expect(
      (
        await execRemoteSsh(
          remote,
          'test ! -S "$HOME/.codex/app-server-control/app-server-control.sock" && echo stopped',
        )
      ).stdout.trim(),
    ).toBe("stopped");
    await start();
    await expect.poll(async () => (await verify()).ok).toBe(true);
    expect(await state()).toBe(before);
  } finally {
    await resetGatewayConfig(page);
    await resetRemoteAppServer(remote);
  }
});

for (const runtimeFixture of ["legacy-node", "npm-codex"] as const) {
  test(`external mode rejects ${runtimeFixture} without installing or upgrading`, async ({
    page,
  }) => {
    // Dedicated targets stay unchanged even if the full upgrade suite runs first.
    const remote = {
      ...(await readRemoteEnv()),
      host:
        runtimeFixture === "legacy-node"
          ? "ssh-target-external-missing"
          : "ssh-target-external-old",
    };
    await openApp(page);
    const host = await authenticatedFetch(
      page,
      {
        url: "/api/hosts",
        method: "POST",
        body: {
          name: `external-${runtimeFixture}`,
          sshHost: remote.host,
          username: remote.username,
          port: Number(remote.port),
          authMode: "password",
          password: remote.password,
          proxyUrl: null,
          codexRuntimeMode: "external",
        },
      },
      (value) => hostRecordSchema.parse(value),
    );
    try {
      const result = await authenticatedFetch(
        page,
        {
          url: "/api/e2e/external-runtime",
          method: "POST",
          body: { hostId: host.id },
        },
        (value) => z.object({ ok: z.boolean(), message: z.string().optional() }).parse(value),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain(
        runtimeFixture === "legacy-node"
          ? "codex executable not found"
          : "Update it outside Gateway",
      );
      await execRemoteSsh(
        remote,
        `set -eu
test ! -e "$HOME/.local/bin/codex"
test ! -e "$HOME/.codex/packages/standalone"
test ! -S "$HOME/.codex/app-server-control/app-server-control.sock"
`,
      );
    } finally {
      await resetGatewayConfig(page);
    }
  });
}

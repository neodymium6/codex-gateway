import { z } from "zod";
import { expect, test } from "./fixtures/remote-workspace";
import { authenticatedFetch, openApp, resetGatewayConfig } from "./helpers/app";
import { hostRecordSchema } from "./helpers/http-schemas";

test("CI connects through real SSH to the official app-server without model credentials", async ({
  page,
  remoteWorkspace,
}) => {
  test.setTimeout(360_000);
  await openApp(page);
  const { remote } = remoteWorkspace;
  const host = await authenticatedFetch(
    page,
    {
      url: "/api/hosts",
      method: "POST",
      body: {
        name: "CI SSH fixture",
        sshHost: remote.host,
        username: remote.username,
        port: Number(remote.port),
        authMode: "password",
        password: remote.password,
        proxyUrl: null,
      },
    },
    (value) => hostRecordSchema.parse(value),
  );
  try {
    const probe = () =>
      authenticatedFetch(
        page,
        { url: "/api/e2e/runtime-smoke", method: "POST", body: { hostId: host.id } },
        (value) =>
          z
            .object({
              ok: z.boolean(),
              appServerVersion: z.string(),
              supportedCodexVersion: z.string(),
              threads: z.object({ data: z.array(z.unknown()) }).loose(),
            })
            .parse(value),
      );
    // The initially empty SSH fixture is provisioned by the real Gateway lifecycle.
    await expect(async () => {
      const result = await probe();
      expect(result.ok).toBe(true);
      expect(result.appServerVersion).toBe(result.supportedCodexVersion);
    }).toPass({ timeout: 300_000, intervals: [1_000, 5_000] });
    // A second browser request must reconnect/read the same real runtime.
    expect((await probe()).ok).toBe(true);
    const unauthenticated = await page.request.get("/api/config/export");
    expect(unauthenticated.status()).toBe(401);
  } finally {
    await resetGatewayConfig(page);
  }
});

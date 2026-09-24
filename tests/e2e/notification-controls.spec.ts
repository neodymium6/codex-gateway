import { expect, test } from "@playwright/test";
import { z } from "zod";
import { openApp, authenticatedFetch } from "./helpers/app";
import { execRemoteSsh, readRemoteEnv } from "./helpers/remote-codex";
import { useBarkReceiver } from "./helpers/bark";
import { sendRealtimeRequest } from "./helpers/realtime";
import { defaultNotificationSettings } from "../../shared/config";
import { notificationSettingsSchema } from "../../server/utils/gateway/http/validation/config";

test("browser notification config preserves defaults and rejects invalid categories", () => {
  expect(notificationSettingsSchema.parse({}).browser).toEqual(
    defaultNotificationSettings().browser,
  );
  for (const category of Object.keys(defaultNotificationSettings().browser)) {
    expect(
      notificationSettingsSchema.parse({ browser: { [category]: false } }).browser,
    ).toMatchObject({ [category]: false });
    expect(notificationSettingsSchema.safeParse({ browser: { [category]: "false" } }).success).toBe(
      false,
    );
  }
  expect(notificationSettingsSchema.safeParse({ browser: { unknown: false } }).success).toBe(false);
});

test("English tooltips, visible composer caret and persisted notification controls use real SSH", async ({
  page,
}) => {
  test.setTimeout(360_000);
  const remote = await readRemoteEnv();
  const bark = await useBarkReceiver();
  await openApp(page);
  const host = await authenticatedFetch(
    page,
    {
      url: "/api/hosts",
      method: "POST",
      body: {
        name: "Notification fixture",
        sshHost: remote.host,
        username: remote.username,
        port: Number(remote.port),
        authMode: "password",
        password: remote.password,
        proxyUrl: null,
      },
    },
    (v) => z.object({ id: z.number() }).parse(v),
  );
  await expect(async () => {
    const result = await authenticatedFetch(
      page,
      {
        url: "/api/e2e/runtime-smoke",
        method: "POST",
        body: { hostId: host.id },
      },
      (v) => z.object({ ok: z.boolean() }).parse(v),
    );
    expect(result.ok).toBe(true);
  }).toPass({ timeout: 180_000, intervals: [1000, 5000] });
  const project = await authenticatedFetch(
    page,
    {
      url: "/api/projects",
      method: "POST",
      body: { hostId: host.id, name: "Notification project", remotePath: remote.projectPath },
    },
    (v) => z.object({ id: z.number() }).parse(v),
  );
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.__codexGatewayE2e?.realtime.readyCount ?? 0))
    .toBeGreaterThan(0);
  const started = await sendRealtimeRequest(page, {
    type: "thread.start",
    requestId: "notification-controls-start",
    hostId: host.id,
    projectId: project.id,
    cwd: remote.projectPath,
  });
  if (started.type !== "thread.started") throw new Error("Real thread did not start");
  await page.goto(`/?hostId=${host.id}&projectId=${project.id}&threadId=${started.threadId}`);
  const input = page.getByTestId("composer-input");
  await expect(input).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await input.click();
    await expect(input).toBeFocused();
    const cursor = page.getByTestId("composer-editor").locator(".cm-cursor").first();
    await expect(cursor).toBeAttached();
    await expect
      .poll(() => cursor.evaluate((el) => getComputedStyle(el).borderLeftColor))
      .toBe(colorScheme === "dark" ? "rgb(241, 241, 239)" : "rgb(0, 0, 0)");
    expect(
      await cursor.evaluate((el) => parseFloat(getComputedStyle(el).borderLeftWidth)),
    ).toBeGreaterThanOrEqual(2);
    expect(await cursor.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(0);
    await expect(cursor).toHaveCSS("visibility", "visible");
  }
  // No text is submitted and no model turn is started.
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: "Notifications", exact: true }).click();
  const switches = page.getByTestId("browser-notification-settings").getByRole("switch");
  await expect(switches).toHaveCount(5);
  for (const control of await switches.all()) await control.click();
  await page.getByRole("button", { name: "Save notification settings", exact: true }).click();
  await expect(page.getByText("Notification settings saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: "Notifications", exact: true }).click();
  for (const control of await switches.all())
    await expect(control).toHaveAttribute("aria-checked", "false");
  const config = await authenticatedFetch(page, { url: "/api/config/export" }, (v) =>
    z.object({ notifications: notificationSettingsSchema }).parse(v),
  );
  config.notifications.bark = {
    enabled: true,
    serverUrl: bark.url,
    deviceKey: bark.deviceKey,
    group: "Notification test",
  };
  await authenticatedFetch(
    page,
    {
      url: "/api/config/notifications",
      method: "POST",
      body: { notifications: config.notifications },
    },
    () => undefined,
  );
  // Real tmux completion checks server English and browser filtering while Bark stays independent.
  await page.reload();
  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: "Notifications", exact: true }).click();
  const session = `notice-${Date.now()}`;
  try {
    for (const enabled of [false, true]) {
      if (enabled) {
        await page.locator("#notify-tmuxCompleted").click();
        await page.getByRole("button", { name: "Save notification settings", exact: true }).click();
        await expect
          .poll(
            async () =>
              await authenticatedFetch(
                page,
                { url: "/api/config/export" },
                (v) =>
                  z.object({ notifications: notificationSettingsSchema }).parse(v).notifications
                    .browser.tmuxCompleted,
              ),
          )
          .toBe(true);
      }
      const ids = (
        await execRemoteSsh(
          remote,
          `tmux new-session -d -s ${session} 'sleep 300'; tmux display-message -p -t ${session} '#{session_id} #{pane_id}'`,
        )
      ).stdout
        .trim()
        .split(/\s+/);
      await authenticatedFetch(
        page,
        {
          url: `/api/hosts/${host.id}/tmux/monitors`,
          method: "POST",
          body: { mode: "once", sessionId: ids[0], paneId: ids[1] },
        },
        () => undefined,
      );
      await execRemoteSsh(remote, `tmux kill-session -t ${session}`);
      await authenticatedFetch(
        page,
        { url: `/api/hosts/${host.id}/tmux/monitors/check`, method: "POST", body: {} },
        () => undefined,
      );
      await expect.poll(async () => (await bark.readRequests()).length).toBe(enabled ? 2 : 1);
      const latest = (await bark.readRequests()).at(-1)!;
      expect(latest.title).toContain("Tmux task finished");
      expect(latest.body).toContain("Session exited");
      expect(latest.body).not.toMatch(/[\p{Script=Han}]/u);
      const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Tmux task finished" });
      if (enabled) await expect(toast).toBeVisible();
      else await expect(toast).toHaveCount(0);
    }
  } finally {
    await execRemoteSsh(remote, `tmux kill-session -t ${session} 2>/dev/null || true`);
  }
});

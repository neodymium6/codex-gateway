import { expect, test } from "@playwright/test";
import { z } from "zod";
import { authenticatedFetch } from "./helpers/app";

const origin = "http://codex.127.0.0.1.nip.io:3100";

test.skip(
  process.env.E2E_GATEWAY_AUTH_MODE !== "trusted-network",
  "Requires trusted-network fixture",
);

test("trusted browser signs in automatically, uses bearer auth and renews a revoked session", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await expect(page.getByTestId("login-form")).toBeHidden();
  await expect(page.getByTestId("open-terminal-button")).toHaveAttribute("title", "Open terminal");
  await expect(page.getByTestId("open-browser-button")).toHaveAttribute("title", "Open browser");
  const config = await authenticatedFetch(page, { url: "/api/config/export" }, (value) =>
    z.object({ version: z.number() }).loose().parse(value),
  );
  expect(config.version).toBe(1);
  expect((await page.request.get("/api/config/export")).status()).toBe(401);
  const token = await page.evaluate(() => localStorage.getItem("codex-gateway-auth-token"));
  expect(token).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await expect(page.getByTestId("open-terminal-button")).toHaveAttribute("title", "Open terminal");
  await expect
    .poll(() => page.evaluate(() => window.__codexGatewayE2e?.realtime.readyCount ?? 0))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem("codex-gateway-auth-token"))).toBe(token);
  const status = await page.evaluate(
    async (value) =>
      (
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { authorization: `Bearer ${value}` },
        })
      ).status,
    token,
  );
  expect(status).toBe(200);
  // The real authenticated realtime socket delivers revocation and triggers re-bootstrap.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("codex-gateway-auth-token")))
    .not.toBe(token);
  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(localStorage.getItem("codex-gateway-auth-token"))))
    .toBe(true);
  expect(
    (
      await page.request.get("/api/config/export", {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(401);
});

test("bootstrap rejects untrusted origins and cannot choose another identity", async ({
  request,
}) => {
  const rejectedHeaders: Record<string, string>[] = [
    {},
    { origin: "https://untrusted.example.test" },
    { origin: "null" },
  ];
  for (const headers of rejectedHeaders) {
    expect((await request.post("/api/auth/bootstrap", { headers, data: {} })).status()).toBe(403);
  }
  const response = await request.post("/api/auth/bootstrap", {
    headers: { origin },
    data: { username: "someone-else" },
  });
  expect(response.status()).toBe(200);
  const result = z
    .object({
      mode: z.literal("trusted-network"),
      session: z.object({ token: z.string(), user: z.object({ username: z.literal("e2e") }) }),
    })
    .parse(await response.json());
  expect(response.headers()["cache-control"]).toBe("no-store");
  await request.post("/api/auth/logout", {
    headers: { authorization: `Bearer ${result.session.token}` },
  });
});

test("English is deployment-configurable and an explicit language choice survives reload", async ({
  page,
}) => {
  const serverHtml = await (await page.request.get("/")).text();
  expect(serverHtml).toContain('title="Open terminal"');
  expect(serverHtml).not.toContain('title="打开终端"');
  await page.goto("/");
  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeHidden();
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "中文" }).click();
  await expect(page.getByRole("tab", { name: "外观" })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await expect(page.getByTestId("open-terminal-button")).toHaveAttribute("title", "打开终端");
  await page.getByTestId("settings-toggle").click();
  await expect(page.getByRole("tab", { name: "外观" })).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("placeholder page loads through nginx and reaches the API", async ({ page }) => {
  const response = await page.goto("/");

  await expect(page).toHaveURL(/\/pages\/sign-in\.html$/);
  await expect(page.getByRole("heading", { name: "Workforce Operations" })).toBeVisible();
  await expect(page.locator("#api-status")).toHaveText("Server status: ok");
  expect(response?.status()).toBe(200);
});

test("API health response is forwarded through nginx", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});

test("browser-facing responses include the required security headers", async ({ request }) => {
  const response = await request.get("/pages/sign-in.html");
  const headers = response.headers();

  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["content-security-policy"]).toContain("style-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  // Local development is HTTP. HSTS is added only by the future HTTPS deployment,
  // because sending it over HTTP has no effect and gives a misleading test result.
  expect(headers["strict-transport-security"]).toBeUndefined();
});

test("localhost accepts a Secure __Host- cookie", async ({ browserName, context, page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const response = await fetch("/api/localhost-cookie-check", { credentials: "include" });
    if (!response.ok) throw new Error(`cookie check returned ${response.status}`);
  });

  const cookie = (await context.cookies()).find(({ name }) => name === "__Host-localhost-check");
  expect(cookie).toMatchObject({
    value: "accepted",
    path: "/",
    secure: true,
    httpOnly: true,
  });

  // Chromium and Firefox retain the Strict metadata. Playwright's WebKit build stores
  // the cookie but exposes SameSite as None; nginx.md records that Safari still needs
  // a branded-browser check before Phase 2 chooses the final session-cookie behavior.
  expect(cookie?.sameSite).toBe(browserName === "webkit" ? "None" : "Strict");
});

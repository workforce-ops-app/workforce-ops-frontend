// The security page in a real browser, behind the real nginx and its Content Security
// Policy (workforce-ops-app/workforce-ops-frontend#61, slice DT7; threats T7 and E8).
//
// Why this test exists: every event on this page is something an attacker sent. If an
// excerpt such as <img src=x onerror=alert(1)> were ever put on the page as HTML, it
// would run for the owner reading the page. The unit tests prove the page builds only
// text in jsdom, which has no policy; this test proves it in Chromium, Firefox, and WebKit
// with the policy nginx really sends. It also checks that someone without security.view
// sees no link to the page and, visiting it directly, a plain "no access" line.
//
// The API stub knows nobody, so the test answers the page's API requests itself
// (Playwright's page.route). The pages, scripts, stylesheets, and policy come from nginx.
import { expect, test } from "@playwright/test";

/** Text that would run a script if it were ever put on the page as HTML. */
const XSS = "<img src=x onerror=alert(1)>";

/**
 * A session, as GET /api/sessions/current answers it.
 * @param {string[]} permissions
 */
function session(permissions) {
  return {
    user: {
      id: "u1",
      display_name: "Olivia Hart",
      email: "olivia@example.com",
      department_id: "d1",
    },
    company: { id: "c1", name: "Northwind Cafe", timezone: "America/Chicago" },
    permissions,
    expires_at: "2099-01-01T00:00:00Z",
    csrf_token: "test-token",
  };
}

/** One event, as GET /api/security-events sends it. */
const EVENT = {
  id: "e1",
  kind: "detection.xss",
  pattern_id: "XSS-02",
  field: "body.notes",
  method: "POST",
  route: "/api/shifts",
  user_id: "u4",
  user_name: "Ben Okafor",
  client_address: "203.0.113.10",
  request_id: "r1",
  excerpt: XSS,
  count: 1,
  occurred_at: "2026-10-05T14:00:00Z",
};

/**
 * Answer the page's API requests, and watch for refusals and dialogs.
 * @param {import("@playwright/test").Page} page
 * @param {{ permissions: string[], refuse?: boolean }} options refuse: answer 403, as the
 *   API does without security.view
 */
async function stubApi(page, options) {
  /** @type {string[]} */
  const refused = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content.Security.Policy/i.test(message.text())) {
      refused.push(message.text());
    }
  });
  /** @type {string[]} */
  const dialogs = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const forbidden = { status: 403, json: { type: "about:blank", title: "Forbidden", status: 403 } };
  await page.route("**/api/sessions/current", (route) =>
    route.fulfill({ json: session(options.permissions) }),
  );
  await page.route("**/api/users?*", (route) =>
    route.fulfill({
      json: { items: [{ id: "u4", display_name: "Ben Okafor" }], next_cursor: null },
    }),
  );
  await page.route("**/api/security-events/summary", (route) =>
    route.fulfill(
      options.refuse
        ? forbidden
        : { json: { kinds: [{ kind: "detection.xss", last_7_days: 1, last_30_days: 3 }] } },
    ),
  );
  await page.route("**/api/security-events?*", (route) =>
    route.fulfill(options.refuse ? forbidden : { json: { items: [EVENT], next_cursor: null } }),
  );
  return { refused, dialogs };
}

test("an attack excerpt shows as text under the real policy", async ({ page }) => {
  const { refused, dialogs } = await stubApi(page, {
    permissions: ["security.view", "user.view"],
  });
  await page.goto("/pages/admin-security.html");

  const card = page.locator("#events article");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".security-event__excerpt")).toHaveText(XSS);
  await expect(card).toContainText("Ben Okafor");
  await expect(card.locator("time")).toHaveText("Mon, Oct 5, 2026, 9:00 AM");
  // The counts: Cross-site scripting, 1 this week, 3 this month.
  await expect(
    page.getByRole("row", { name: /Cross-site scripting/ }).getByRole("cell"),
  ).toHaveText(["1", "3"]);
  // The Security entry of the administration menu is there, marked as this page.
  await expect(page.getByRole("link", { name: "Security" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await expect(page.locator("main img")).toHaveCount(0);
  expect(dialogs).toEqual([]);
  expect(refused).toEqual([]);
});

test("without security.view there is no link, and a direct visit says no access", async ({
  page,
}) => {
  const { refused } = await stubApi(page, { permissions: ["user.view"], refuse: true });
  await page.goto("/pages/admin-security.html");

  await expect(page.locator("#status")).toHaveText("You do not have access to security events.");
  await expect(page.locator("#events article")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Security" })).toBeHidden();
  expect(refused).toEqual([]);
});

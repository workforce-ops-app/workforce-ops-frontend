// The home screen (My week) in a real browser, behind the real nginx and its Content
// Security Policy (workforce-ops-app/workforce-ops-frontend#63): a manager gets the
// attention tiles and their links, an employee does not, and both see their upcoming
// time off. The unit tests cover the rules in jsdom; this test checks the page as shipped,
// with its stylesheets, in Chromium, Firefox, and WebKit, and that the browser refuses
// nothing.
//
// The API stub knows nobody, so the test answers the page's API requests itself
// (Playwright's page.route), as the announcements test does.
import { expect, test } from "@playwright/test";

/** The person, their company, and the session's other fields; permissions vary. */
const BASE = {
  user: { id: "u1", display_name: "Ana Diaz", email: "ana@example.com", department_id: "d1" },
  company: { id: "c1", name: "Northwind Cafe", timezone: "America/Chicago" },
  expires_at: "2099-01-01T00:00:00Z",
  csrf_token: "test-token",
};

/** What an employee may do: their own week and their own time off. */
const EMPLOYEE = ["schedule.view_self", "time_off.request_self"];
/** A manager also reviews time off and plans the department week. */
const MANAGER = [...EMPLOYEE, "schedule.view", "schedule.edit", "time_off.review"];

/**
 * A time-off request far in the future, so it is always still to come.
 * @param {string} id
 * @param {string} status
 * @param {string} day
 */
function request(id, status, day) {
  return {
    id,
    employee_id: "u1",
    employee_name: "Ana Diaz",
    first_day: day,
    last_day: day,
    reason: null,
    status,
    not_reviewed: false,
    created_at: "2026-10-01T12:00:00Z",
    decided_at: null,
  };
}

/** One open shift (nobody assigned), 8 hours. */
const OPEN_SHIFT = {
  id: "s1",
  department: { id: "d1", name: "Kitchen", timezone: null },
  employee: null,
  starts_at: "2026-10-08T13:00:00Z",
  ends_at: "2026-10-08T21:00:00Z",
  status: "scheduled",
  details: "Cook",
  notes: null,
};

/**
 * Answer the page's API requests here, and watch the console for anything the policy
 * refused.
 * @param {import("@playwright/test").Page} page
 * @param {string[]} permissions
 * @returns {Promise<{ refused: string[], asked: string[] }>}
 */
async function stubApi(page, permissions) {
  /** @type {string[]} */
  const refused = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content.Security.Policy/i.test(message.text())) {
      refused.push(message.text());
    }
  });
  // Every API path the page asked for, to check what each kind of person sends.
  /** @type {string[]} */
  const asked = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) asked.push(url.pathname);
  });

  await page.route("**/api/sessions/current", (route) =>
    route.fulfill({ json: { ...BASE, permissions } }),
  );
  // My week and the department's open work both ask for shifts; one open shift either way.
  await page.route("**/api/shifts?*", (route) =>
    route.fulfill({ json: { items: [OPEN_SHIFT], next_cursor: null } }),
  );
  await page.route("**/api/announcements?*", (route) =>
    route.fulfill({ json: { items: [], next_cursor: null } }),
  );
  await page.route("**/api/time-off-requests?*", (route) =>
    route.fulfill({
      json: {
        items: [
          request("t1", "approved", "2099-03-02"),
          request("t2", "pending", "2099-02-10"),
          request("t3", "denied", "2099-01-05"),
        ],
        next_cursor: null,
      },
    }),
  );
  await page.route("**/api/time-off-requests/waiting?*", (route) =>
    route.fulfill({ json: { items: [request("w1", "pending", "2099-02-11")], next_cursor: null } }),
  );
  return { refused, asked };
}

test("a manager sees what needs their attention, with links to act on it", async ({ page }) => {
  const { refused, asked } = await stubApi(page, MANAGER);
  await page.goto("/pages/my-shifts.html");

  const attention = page.getByRole("region", { name: "Needs your attention" });
  await expect(attention.locator(".stat")).toHaveCount(3);
  await expect(attention.locator(".stat").nth(0)).toContainText("Time off to review1");
  await expect(attention.locator(".stat").nth(1)).toContainText("Open shifts this week1");
  await expect(attention.locator(".stat").nth(2)).toContainText("Open hours this week8");
  await expect(attention.locator(".stat--attention")).toHaveCount(3);

  // The menu's count and the tile share one request for the waiting list.
  expect(asked.filter((path) => path === "/api/time-off-requests/waiting")).toHaveLength(1);

  await attention.getByRole("link", { name: "Plan the department week" }).click();
  await expect(page).toHaveURL(/\/pages\/schedule\.html$/);
  expect(refused).toEqual([]);
});

test("an employee sees their upcoming time off and no attention panel", async ({ page }) => {
  const { refused, asked } = await stubApi(page, EMPLOYEE);
  await page.goto("/pages/my-shifts.html");

  const timeOff = page.getByRole("region", { name: "My time off" });
  // Soonest first; the denied one stays on the Time off page.
  await expect(timeOff.locator("li")).toHaveCount(2);
  await expect(timeOff.locator("li").nth(0)).toContainText("Waiting for review");
  await expect(timeOff.locator("li").nth(1)).toContainText("Approved");

  await expect(page.getByRole("region", { name: "Needs your attention" })).toHaveCount(0);
  expect(asked).not.toContain("/api/time-off-requests/waiting");

  await timeOff.getByRole("link", { name: "All my time off" }).click();
  await expect(page).toHaveURL(/\/pages\/time-off\.html$/);
  expect(refused).toEqual([]);
});

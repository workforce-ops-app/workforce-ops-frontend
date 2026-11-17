// The department week's timeline in a real browser, behind the real nginx and its Content
// Security Policy (workforce-ops-app/workforce-ops-frontend#53).
//
// Why this test exists: the policy is style-src 'self', which refuses style attributes.
// The timeline places its bars by setting CSS custom properties through the DOM (the
// CSSOM), which the policy allows. The unit tests run in jsdom, which has no policy at
// all, so only a real browser can prove that the bars are really placed and that nothing
// was refused. If someone later writes bar.setAttribute("style", ...) instead, the browser
// refuses it, every bar falls back to the same spot, and this test fails.
//
// The API stub knows nobody, so the test answers the page's three API requests itself
// (Playwright's page.route): the session, the departments, and one week of shifts. The
// page, its scripts, its stylesheets, and the policy header still come from nginx.
import { expect, test } from "@playwright/test";

/** The week shown: Monday, October 5, 2026, in Chicago. */
const WEEK = "2026-10-05";

/** A session for a manager in Kitchen, as GET /api/sessions/current answers it. */
const SESSION = {
  user: { id: "u1", display_name: "Ana Diaz", email: "ana@example.com", department_id: "d1" },
  company: { id: "c1", name: "Northwind Cafe", timezone: "America/Chicago" },
  permissions: ["schedule.view", "schedule.view_self"],
  expires_at: "2099-01-01T00:00:00Z",
  csrf_token: "test-token",
};

/**
 * One shift, as the shifts API sends it.
 * @param {string} id
 * @param {{ id: string, display_name: string }} employee
 * @param {string} startsAt UTC
 * @param {string} endsAt UTC
 */
function shift(id, employee, startsAt, endsAt) {
  return {
    id,
    department: { id: "d1", name: "Kitchen" },
    employee,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: "America/Chicago",
    status: "scheduled",
    details: "Line cook",
    notes: null,
    event_name: null,
    event_description: null,
  };
}

const ANA = { id: "u1", display_name: "Ana Diaz" };
const BEN = { id: "u2", display_name: "Ben Okafor" };

/** Ana works Monday 9:00 to 17:00; Ben works Wednesday night, 22:00 to Thursday 6:00. */
const SHIFTS = [
  shift("s1", ANA, "2026-10-05T14:00:00Z", "2026-10-05T22:00:00Z"),
  shift("s2", BEN, "2026-10-08T03:00:00Z", "2026-10-08T11:00:00Z"),
];

test("the timeline draws each shift where it belongs, under the real policy", async ({ page }) => {
  // A laptop-sized window, where the timeline is shown instead of the day cards.
  await page.setViewportSize({ width: 1440, height: 900 });

  // Anything the browser refuses because of the policy shows up as a console error.
  /** @type {string[]} */
  const refused = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content.Security.Policy/i.test(message.text())) {
      refused.push(message.text());
    }
  });

  // The page's API requests, answered here instead of by a real backend.
  await page.route("**/api/sessions/current", (route) => route.fulfill({ json: SESSION }));
  await page.route("**/api/departments*", (route) =>
    route.fulfill({ json: { items: [{ id: "d1", name: "Kitchen" }], next_cursor: null } }),
  );
  await page.route("**/api/shifts?*", (route) =>
    route.fulfill({ json: { items: SHIFTS, next_cursor: null } }),
  );

  await page.goto(`/pages/schedule.html?week=${WEEK}&department=d1`);

  // A row per person, by name.
  const rows = page.locator("#timeline tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator("th")).toHaveText("Ana Diaz");

  // Where the bars really ended up on screen, next to the day headers above them.
  const box = async (/** @type {import("@playwright/test").Locator} */ locator) => {
    const found = await locator.boundingBox();
    if (!found) throw new Error("not on screen");
    return found;
  };
  const monday = await box(page.locator("#timeline thead th[data-day='2026-10-05']"));
  const wednesday = await box(page.locator("#timeline thead th[data-day='2026-10-07']"));
  const thursday = await box(page.locator("#timeline thead th[data-day='2026-10-08']"));
  const anaBar = await box(rows.nth(0).locator(".week-timeline__bar"));
  const benBar = await box(rows.nth(1).locator(".week-timeline__bar"));

  // Ana: Monday from 9:00 (9/24 of the day in) for 8 hours (a third of the day). Allow a
  // few pixels for the gaps between bars and rounding.
  expect(Math.abs(anaBar.x - (monday.x + (monday.width * 9) / 24))).toBeLessThan(4);
  expect(Math.abs(anaBar.width - monday.width / 3)).toBeLessThan(6);

  // Ben: starts late on Wednesday and crosses the line into Thursday morning.
  expect(Math.abs(benBar.x - (wednesday.x + (wednesday.width * 22) / 24))).toBeLessThan(4);
  expect(benBar.x + benBar.width).toBeGreaterThan(thursday.x);
  expect(benBar.x + benBar.width).toBeLessThan(thursday.x + thursday.width / 2);

  // The overnight shift says so on screen, not only by where it is drawn.
  await expect(rows.nth(1).locator(".timeline-shift__next-day")).toHaveText("+1");

  // And the browser refused nothing.
  expect(refused).toEqual([]);
});

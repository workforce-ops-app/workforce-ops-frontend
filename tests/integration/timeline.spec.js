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

/**
 * Answer the page's API requests here instead of by a real backend, and open the week.
 * @param {import("@playwright/test").Page} page
 * @param {object[]} [shifts] the week's shifts (SHIFTS unless a test needs others)
 */
async function openWeek(page, shifts = SHIFTS) {
  await page.route("**/api/sessions/current", (route) => route.fulfill({ json: SESSION }));
  await page.route("**/api/departments*", (route) =>
    route.fulfill({ json: { items: [{ id: "d1", name: "Kitchen" }], next_cursor: null } }),
  );
  await page.route("**/api/shifts?*", (route) =>
    route.fulfill({ json: { items: shifts, next_cursor: null } }),
  );
  await page.goto(`/pages/schedule.html?week=${WEEK}&department=d1`);
}

/**
 * Where something really is on screen, in pixels.
 * @param {import("@playwright/test").Locator} locator
 */
async function box(locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
}

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

  await openWeek(page);

  // A row per person, by name.
  const rows = page.locator("#timeline tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator("th")).toHaveText("Ana Diaz");

  // Where the bars really ended up on screen, next to the day headers above them.
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

  // The "12p" label under Monday sits over Monday's noon line: the middle of the column.
  const noon = await box(
    page.locator("#timeline thead th[data-day='2026-10-05'] .week-timeline__tick--noon"),
  );
  expect(Math.abs(noon.x + noon.width / 2 - (monday.x + monday.width / 2))).toBeLessThan(2);

  // And the browser refused nothing.
  expect(refused).toEqual([]);
});

test("the names stay pinned on the left while the week scrolls sideways", async ({ page }) => {
  // A small laptop window: too narrow for the whole week, so the card scrolls.
  await page.setViewportSize({ width: 1100, height: 800 });
  await openWeek(page);

  const card = page.locator("#timeline");
  const name = page.locator("#timeline tbody th").first();
  await expect(name).toHaveText("Ana Diaz");
  const before = await box(name);

  // Scroll the week as far right as it goes (Sunday in view).
  await card.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  // At 1100px the card is about 100px narrower than the week, so that is as far as it
  // goes; 50px is plenty to prove it really scrolled.
  await expect.poll(() => card.evaluate((element) => element.scrollLeft)).toBeGreaterThan(50);

  // The name has not moved, and it is drawn over the track, not under it: the point at its
  // middle belongs to the name cell.
  const after = await box(name);
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  const onTop = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("th")?.textContent ?? null,
    { x: after.x + after.width / 2, y: after.y + after.height / 2 },
  );
  expect(onTop).toBe("Ana Diaz");
});

test("each bar shows the length of its time that fits it, and the whole time on hover", async ({
  page,
}) => {
  // A wide desktop screen, where the page uses most of the window. Ana works an 8-hour day
  // shift (a bar about 70px wide here), Ben a 12-hour one (about 110px).
  await page.setViewportSize({ width: 1920, height: 900 });
  await openWeek(page, [
    shift("s1", ANA, "2026-10-05T14:00:00Z", "2026-10-05T22:00:00Z"),
    shift("s2", BEN, "2026-10-06T11:00:00Z", "2026-10-06T23:00:00Z"),
  ]);
  const rows = page.locator("#timeline tbody tr");
  await expect(rows).toHaveCount(2);

  // The one length on screen in a row's bar (the stylesheet's container queries hide the
  // other two, so this also proves the browser applied them).
  const shown = (/** @type {number} */ row) =>
    rows.nth(row).locator(".timeline-shift__time:visible");

  // Ana's 8-hour bar: the short form, start and end together.
  await expect(shown(0)).toHaveCount(1);
  await expect(shown(0)).toHaveText("9a-5p");
  // Ben's 12-hour bar has room for the full form.
  await expect(shown(1)).toHaveCount(1);
  await expect(shown(1)).toHaveText("6 AM - 6 PM");

  // Each stays on one line: the label is no taller than one line of its text.
  const line = await shown(0).evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: element.getBoundingClientRect().height, line: parseFloat(style.lineHeight) };
  });
  expect(line.height).toBeLessThanOrEqual(line.line + 1);

  // Pointing at a bar shows its whole time, whatever length the bar shows.
  await expect(rows.nth(0).locator("button.timeline-shift")).toHaveAttribute(
    "title",
    "9 AM - 5 PM",
  );

  // The page really is wider than the 90rem used on smaller laptops (1440px).
  const card = await box(page.locator("#timeline"));
  expect(card.width).toBeGreaterThan(1440);
});

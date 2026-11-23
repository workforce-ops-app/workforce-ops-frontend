// The department week's calendar in a real browser, behind the real nginx and its Content
// Security Policy (workforce-ops-app/workforce-ops-frontend#82).
//
// Why this test exists: the policy is style-src 'self', which refuses style attributes.
// The calendar places its blocks by setting CSS custom properties through the DOM (the
// CSSOM), which the policy allows. The unit tests run in jsdom, which has no policy and
// no layout at all, so only a real browser can prove that the blocks are really placed and
// that nothing was refused. If someone later writes block.setAttribute("style", ...)
// instead, the browser refuses it, every block falls back to the same spot, and this test
// fails.
//
// The API stub knows nobody, so the test answers the page's API requests itself
// (Playwright's page.route): the session, the departments, and the shifts. The page, its
// scripts, its stylesheets, and the policy header still come from nginx.
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

/** The company's two departments. */
const DEPARTMENTS = [
  { id: "d1", name: "Kitchen" },
  { id: "d2", name: "Front of House" },
];

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
const CARA = { id: "u3", display_name: "Cara Lee" };

/**
 * Kitchen's week: Ana works Monday 9:00 to 17:00 and Ben Monday 11:00 to 19:00 (the two
 * overlap); Cara works Wednesday night, 22:00 to Thursday 6:00. (Chicago is UTC-5 in
 * October.)
 */
const KITCHEN = [
  shift("s1", ANA, "2026-10-05T14:00:00Z", "2026-10-05T22:00:00Z"),
  shift("s2", BEN, "2026-10-05T16:00:00Z", "2026-10-06T00:00:00Z"),
  shift("s3", CARA, "2026-10-08T03:00:00Z", "2026-10-08T11:00:00Z"),
];

/** Front of House's week: one Tuesday shift. */
const FRONT = [shift("f1", BEN, "2026-10-06T14:00:00Z", "2026-10-06T22:00:00Z")];

/**
 * Answer the page's API requests here instead of by a real backend, and open the week.
 * The shifts depend on the department asked for, like the real API.
 * @param {import("@playwright/test").Page} page
 */
async function openWeek(page) {
  await page.route("**/api/sessions/current", (route) => route.fulfill({ json: SESSION }));
  // The person's departments, each with what they may do there (GET /api/departments/mine).
  await page.route("**/api/departments/mine", (route) =>
    route.fulfill({
      json: {
        items: DEPARTMENTS.map((department) => ({
          ...department,
          timezone: null,
          permissions: ["schedule.view"],
        })),
      },
    }),
  );
  await page.route("**/api/shifts?*", (route) => {
    const department = new URL(route.request().url()).searchParams.get("department_id");
    const items = department === "d2" ? FRONT : KITCHEN;
    return route.fulfill({ json: { items, next_cursor: null } });
  });
  await page.goto(`/pages/schedule.html?week=${WEEK}&department=d1`);
}

/**
 * Where something really is on the page, in pixels.
 * @param {import("@playwright/test").Locator} locator
 */
async function box(locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
}

/**
 * Collect anything the browser refuses because of the policy (it shows up as a console
 * error, or as a securitypolicyviolation event on the page).
 * @param {import("@playwright/test").Page} page
 */
function watchPolicy(page) {
  /** @type {string[]} */
  const refused = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content.Security.Policy/i.test(message.text())) {
      refused.push(message.text());
    }
  });
  return refused;
}

test("the calendar draws each block where it belongs, under the real policy", async ({ page }) => {
  // A laptop-sized window, where the calendar is shown instead of the day cards.
  await page.setViewportSize({ width: 1440, height: 900 });
  const refused = watchPolicy(page);
  await page.addInitScript(() => {
    // Policy refusals also fire this event; count them for the check at the end.
    window.addEventListener("securitypolicyviolation", () => {
      const counted = /** @type {any} */ (window);
      counted.refusals = (counted.refusals ?? 0) + 1;
    });
  });
  await openWeek(page);

  const calendar = page.locator("#calendar");
  const day = (/** @type {string} */ key) =>
    calendar.locator(`.week-calendar__day[data-day='${key}']`);
  await expect(day("2026-10-05").locator(".week-calendar__block")).toHaveCount(2);

  // Ana: in the Monday column, 9/24 of the way down, 8/24 of the day tall. The column is
  // the whole day, so its own box is the ruler (wherever the calendar has scrolled to).
  const monday = await box(day("2026-10-05"));
  const ana = await box(day("2026-10-05").locator(".week-calendar__block[data-person='u1']"));
  const ben = await box(day("2026-10-05").locator(".week-calendar__block[data-person='u2']"));
  expect(Math.abs(ana.y - (monday.y + (monday.height * 9) / 24))).toBeLessThan(3);
  expect(Math.abs(ana.height - (monday.height * 8) / 24)).toBeLessThan(4);
  expect(Math.abs(ana.x - monday.x)).toBeLessThan(4);

  // Ben overlaps her, so the two sit side by side, each about half the column wide: Ana on
  // the left (she starts first), Ben on the right, both inside the Monday column.
  expect(Math.abs(ben.y - (monday.y + (monday.height * 11) / 24))).toBeLessThan(3);
  expect(ana.width).toBeLessThan(monday.width / 2 + 2);
  expect(ana.width).toBeGreaterThan(monday.width / 2 - 8);
  expect(ben.x).toBeGreaterThanOrEqual(ana.x + ana.width - 1);
  expect(ben.x + ben.width).toBeLessThanOrEqual(monday.x + monday.width + 1);

  // Cara's night shift is two pieces: Wednesday from 22:00 to the bottom, and Thursday
  // from the top to 6:00.
  const wednesday = await box(day("2026-10-07"));
  const thursday = await box(day("2026-10-08"));
  const evening = await box(day("2026-10-07").locator(".week-calendar__block"));
  const morning = await box(day("2026-10-08").locator(".week-calendar__block"));
  expect(Math.abs(evening.y - (wednesday.y + (wednesday.height * 22) / 24))).toBeLessThan(3);
  expect(Math.abs(evening.y + evening.height - (wednesday.y + wednesday.height))).toBeLessThan(3);
  expect(Math.abs(morning.y - thursday.y)).toBeLessThan(3);
  expect(
    Math.abs(morning.y + morning.height - (thursday.y + (thursday.height * 6) / 24)),
  ).toBeLessThan(3);
  // The evening piece says "+1" on screen, the morning piece when it ends.
  await expect(day("2026-10-07").locator(".calendar-shift__next-day")).toHaveText("+1");
  await expect(day("2026-10-08").locator(".calendar-shift__time:visible")).toHaveText("until 6 AM");

  // The colour came through the stylesheet: Ana's block has a tint, not the browser's
  // default button grey or nothing at all.
  const tint = await day("2026-10-05")
    .locator("button.calendar-shift")
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(tint).not.toBe("rgba(0, 0, 0, 0)");
  expect(tint).not.toBe("rgb(240, 240, 240)");

  // It opened scrolled to the week's earliest shift (9 AM, Ana's), not at midnight. The
  // scroll can wait a frame for the calendar to be laid out (openAtFirstShift), so ask
  // until it has happened.
  const scrolled = () =>
    calendar.locator(".week-calendar__scroll").evaluate((element) => element.scrollTop);
  await expect.poll(scrolled).toBeGreaterThan((monday.height * 8) / 24);
  expect(await scrolled()).toBeLessThan((monday.height * 9.5) / 24);

  // And the browser refused nothing.
  expect(refused).toEqual([]);
  expect(await page.evaluate(() => /** @type {any} */ (window).refusals ?? 0)).toBe(0);
});

test("the department picker shows another department for the same week", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const refused = watchPolicy(page);
  await openWeek(page);

  const picker = page.getByLabel("Department", { exact: true });
  await expect(picker).toBeVisible();
  await expect(picker).toHaveValue("d1");
  await expect(page.locator("#title")).toHaveText("Kitchen");

  await picker.selectOption("d2");

  // The heading, the address, and the calendar follow; the week stays the same.
  await expect(page.locator("#title")).toHaveText("Front of House");
  await expect(page).toHaveURL(/department=d2/);
  await expect(page).toHaveURL(new RegExp(`week=${WEEK}`));
  await expect(page.locator("#calendar .week-calendar__block")).toHaveCount(1);
  await expect(
    page.locator("#calendar .week-calendar__day[data-day='2026-10-06'] .week-calendar__block"),
  ).toHaveCount(1);

  // Back returns to Kitchen.
  await page.goBack();
  await expect(page.locator("#title")).toHaveText("Kitchen");
  await expect(picker).toHaveValue("d1");
  expect(refused).toEqual([]);
});

test("a red line marks the time it is now in today's column", async ({ page }) => {
  // Freeze the browser's clock at Monday, October 5, 1:00 PM in Chicago (18:00 UTC), in
  // the week shown. The line follows the workplace's clock (the shifts' zone, Chicago),
  // whatever zone the browser itself is in.
  await page.clock.install({ time: new Date("2026-10-05T18:00:00Z") });
  await page.setViewportSize({ width: 1440, height: 900 });
  const refused = watchPolicy(page);
  await openWeek(page);

  const calendar = page.locator("#calendar");
  const monday = calendar.locator(".week-calendar__day[data-day='2026-10-05']");
  const line = calendar.locator(".week-calendar__now");
  await expect(line).toHaveCount(1);
  // In Monday's column, hidden from screen readers.
  await expect(monday.locator(".week-calendar__now")).toHaveCount(1);
  await expect(line).toHaveAttribute("aria-hidden", "true");

  // 13/24 of the way down the day (1:00 PM), across the column's width. The column's own
  // box is the ruler, wherever the calendar has scrolled to.
  const column = await box(monday);
  let drawn = await box(line);
  expect(Math.abs(drawn.y - (column.y + (column.height * 13) / 24))).toBeLessThan(3);
  expect(Math.abs(drawn.width - column.width)).toBeLessThan(3);

  // An hour later the line has moved down by an hour (the page moves it every minute).
  await page.clock.runFor(60 * 60 * 1000);
  drawn = await box(line);
  expect(Math.abs(drawn.y - (column.y + (column.height * 14) / 24))).toBeLessThan(3);

  // Placed through the CSSOM: the policy refused nothing.
  expect(refused).toEqual([]);
});

test("the people menu hides a person's blocks and gives the others their width back", async ({
  page,
}) => {
  // The menu sits on the left of the calendar on a laptop (#83).
  await page.setViewportSize({ width: 1440, height: 900 });
  const refused = watchPolicy(page);
  await openWeek(page);

  const menu = page.getByRole("region", { name: "People" });
  await expect(menu).toBeVisible();
  const calendar = page.locator("#calendar");
  const monday = calendar.locator(".week-calendar__day[data-day='2026-10-05']");
  const anaBlock = monday.locator(".week-calendar__block[data-person='u1']");
  const benBlock = monday.locator(".week-calendar__block[data-person='u2']");
  await expect(benBlock).toBeVisible();
  // The menu is beside the calendar, not above it.
  expect((await box(menu)).x + (await box(menu)).width).toBeLessThanOrEqual(
    (await box(calendar)).x + 1,
  );

  // Switch Ben off: his block goes, and Ana's takes the whole Monday column again.
  const ben = menu.getByRole("button", { name: /Ben Okafor/ });
  await expect(ben).toHaveAttribute("aria-pressed", "true");
  await ben.click();
  await expect(ben).toHaveAttribute("aria-pressed", "false");
  await expect(benBlock).toBeHidden();
  const column = await box(monday);
  await expect.poll(async () => (await box(anaBlock)).width).toBeGreaterThan(column.width - 10);
  await expect(page.locator("#stats .stats__filter")).toContainText("2 of 3 people");

  // Search: only Cara's night shift (both pieces) is left.
  await menu.getByLabel("Search names").fill("cara");
  await expect(anaBlock).toBeHidden();
  await expect(calendar.locator(".week-calendar__block:visible")).toHaveCount(2);
  await expect(menu.getByRole("status")).toHaveText("1 of 3 people shown");

  // Clear filters: everyone is back.
  await menu.getByRole("button", { name: "Clear filters" }).click();
  await expect(calendar.locator(".week-calendar__block:visible")).toHaveCount(4);
  await expect(page.locator("#stats .stats__filter")).toHaveCount(0);
  expect(refused).toEqual([]);

  // On a phone the calendar is hidden, and so is the menu (the day cards show instead).
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(menu).toBeHidden();
});

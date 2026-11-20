// Announcements in a real browser, behind the real nginx and its Content Security Policy
// (workforce-ops-app/workforce-ops-frontend#78, threat T5: stored cross-site scripting).
//
// Why this test exists: an announcement reaches everyone in its audience, so a script in
// one would run for every reader. The unit tests prove the renderer builds only text and
// <strong> in jsdom, which has no policy at all; this test proves it in Chromium, Firefox,
// and WebKit, with the policy nginx really sends: **bold** shows as a <strong>, an
// <img onerror> shows as the characters typed with no image element on the page, and the
// browser refuses nothing (a refusal would mean something tried to run inline code or
// style). It also checks that opening an announcement sends the read mark, with the CSRF
// token.
//
// The API stub knows nobody, so the test answers the page's API requests itself
// (Playwright's page.route): the session, the announcements list, the read mark, and, for
// My week, an empty week of shifts. The pages, their scripts, their stylesheets, and the
// policy header still come from nginx.
import { expect, test } from "@playwright/test";

/** A session for an employee in Kitchen, as GET /api/sessions/current answers it. */
const SESSION = {
  user: { id: "u1", display_name: "Ana Diaz", email: "ana@example.com", department_id: "d1" },
  company: { id: "c1", name: "Northwind Cafe", timezone: "America/Chicago" },
  permissions: ["schedule.view_self"],
  expires_at: "2099-01-01T00:00:00Z",
  csrf_token: "test-token",
};

/** Text that would run a script if it were ever put on the page as HTML. */
const XSS = "<img src=x onerror=alert(1)>";

/**
 * One announcement, as the announcements API sends it.
 * @param {string} id
 * @param {string} title
 * @param {string} body
 * @param {{ read?: boolean, edited?: boolean }} [options]
 */
function announcement(id, title, body, options = {}) {
  return {
    id,
    audience: {
      type: "department",
      department_id: "d1",
      department_name: "Kitchen",
      team_id: null,
      team_name: null,
    },
    title,
    body,
    author: { id: "u9", display_name: "Maria Lopez" },
    posted_at: "2026-10-05T14:00:00Z",
    edited_at: options.edited ? "2026-10-06T15:00:00Z" : null,
    archived: false,
    read: options.read ?? false,
  };
}

/** Newest first: a bold one (unread), one with the payload (read, edited), and an older one. */
const FIRST_PAGE = [
  announcement("a3", "Inventory **tonight**", "Please stay **late**.\nPizza provided."),
  announcement("a2", `Careful ${XSS}`, `Body ${XSS} and **${XSS}**`, { read: true, edited: true }),
];
const SECOND_PAGE = [announcement("a1", "Welcome", "First announcement.", { read: true })];

/**
 * Answer the page's API requests here instead of by a real backend, and watch the console
 * for anything the policy refused.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ refused: string[], dialogs: string[], reads: { id: string, token: string | null }[] }>}
 */
async function stubApi(page) {
  /** @type {string[]} */
  const refused = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content.Security.Policy/i.test(message.text())) {
      refused.push(message.text());
    }
  });
  // A script that ran (alert(1)) would open a dialog: note it and close it.
  /** @type {string[]} */
  const dialogs = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  /** @type {{ id: string, token: string | null }[]} */
  const reads = [];

  await page.route("**/api/sessions/current", (route) => route.fulfill({ json: SESSION }));
  await page.route("**/api/shifts?*", (route) =>
    route.fulfill({ json: { items: [], next_cursor: null } }),
  );
  // The list: the second page when the cursor of the first is sent back.
  await page.route("**/api/announcements?*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor") === "page-2") {
      return route.fulfill({ json: { items: SECOND_PAGE, next_cursor: null } });
    }
    const limit = Number(url.searchParams.get("limit") ?? "50");
    return route.fulfill({
      json: { items: FIRST_PAGE.slice(0, limit), next_cursor: "page-2" },
    });
  });
  // The read mark: 204, as the API answers. The ID and the CSRF header are kept.
  await page.route("**/api/announcements/*/read", (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split("/")[3];
    reads.push({ id, token: request.headers()["x-csrf-token"] ?? null });
    return route.fulfill({ status: 204 });
  });
  return { refused, dialogs, reads };
}

test("bold shows as bold, HTML as text, under the real policy", async ({ page }) => {
  const { refused, dialogs } = await stubApi(page);
  await page.goto("/pages/announcements.html");

  const cards = page.locator("#announcements article");
  await expect(cards).toHaveCount(2);

  // The bold title and, once opened, the bold message are real <strong> elements.
  const bold = cards.nth(0);
  await expect(bold.locator(".announcement__title strong")).toHaveText("tonight");
  await bold.getByRole("button").click();
  await expect(bold.locator(".announcement__body strong")).toHaveText("late");
  // The line break is kept on screen: innerText is the text as the browser lays it out,
  // so it holds the newline only if the stylesheet (white-space: pre-line) really shows it.
  expect(await bold.locator(".announcement__body").innerText()).toBe(
    "Please stay late.\nPizza provided.",
  );

  // The payload is shown as the characters typed, in the title and the message, and the
  // page holds no image at all outside the brand's logo.
  const unsafe = cards.nth(1);
  await unsafe.getByRole("button").click();
  await expect(unsafe.locator(".announcement__title")).toHaveText(`Careful ${XSS}`);
  await expect(unsafe.locator(".announcement__body")).toHaveText(`Body ${XSS} and ${XSS}`);
  await expect(unsafe.locator(".announcement__body strong")).toHaveText(XSS);
  await expect(page.locator("#announcements img")).toHaveCount(0);
  await expect(page.locator("main img")).toHaveCount(0);

  // The facts line: who, to whom, when (in Chicago), and "Edited".
  await expect(unsafe.locator(".announcement__meta")).toHaveText(
    "From Maria Lopez · To Kitchen department · Mon, Oct 5, 2026, 9:00 AM · Edited",
  );

  // No dialog appeared (alert(1) never ran), and the browser refused nothing.
  expect(dialogs).toEqual([]);
  expect(refused).toEqual([]);
});

test("opening an unread announcement sends the read mark, once", async ({ page }) => {
  const { refused, reads } = await stubApi(page);
  await page.goto("/pages/announcements.html");

  const card = page.locator("#announcements article").nth(0);
  const toggle = card.getByRole("button");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // "Unread" is a word in the button's name, not only a colour.
  await expect(toggle).toHaveAccessibleName(/^Unread/);

  const posted = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/announcements/a3/read"),
  );
  await toggle.click();
  await posted;

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator(".announcement__unread")).toHaveCount(0);
  // Closing and opening again sends nothing more; one already read sends nothing at all.
  await toggle.click();
  await toggle.click();
  await page.locator("#announcements article").nth(1).getByRole("button").click();
  expect(reads).toEqual([{ id: "a3", token: "test-token" }]);
  expect(refused).toEqual([]);
});

test("Load more adds the next page and then goes away", async ({ page }) => {
  const { refused } = await stubApi(page);
  await page.goto("/pages/announcements.html");

  const more = page.getByRole("button", { name: "Load more announcements" });
  await expect(page.locator("#announcements article")).toHaveCount(2);
  await more.click();

  await expect(page.locator("#announcements article")).toHaveCount(3);
  await expect(page.locator("#announcements article").nth(2)).toContainText("Welcome");
  await expect(more).toBeHidden();
  expect(refused).toEqual([]);
});

test("My week shows the newest announcements and links to all of them", async ({ page }) => {
  const { refused } = await stubApi(page);
  await page.goto("/pages/my-shifts.html?week=2026-10-05");

  const section = page.getByRole("region", { name: "Announcements" });
  await expect(section.locator("article")).toHaveCount(2);
  await expect(section.locator("article h3 strong").first()).toHaveText("tonight");
  await expect(section.locator("img")).toHaveCount(0);

  // Every page's tab bar has the Announcements tab; the link under the list goes there too.
  await expect(page.getByRole("navigation", { name: "Main" })).toContainText("Announcements");
  await section.getByRole("link", { name: "See all announcements" }).click();
  await expect(page).toHaveURL(/\/pages\/announcements\.html$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Announcements");
  expect(refused).toEqual([]);
});

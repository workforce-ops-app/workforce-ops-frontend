// Managing announcements in a real browser, behind the real nginx and its Content Security
// Policy (workforce-ops-app/workforce-ops-frontend#79, slice AN5; threats T5 and E11).
//
// Why this test exists: a manager's text is shown back in three places on this page (the
// list, the form's preview, and the read list's heading), and an announcement reaches
// everyone in its audience, so a script in one would run for every reader. The unit tests
// prove the page builds only text and <strong> in jsdom, which has no policy at all; this
// test proves it in Chromium, Firefox, and WebKit with the policy nginx really sends. It
// also checks that the form offers only the audiences the server lists, that the post
// carries the CSRF token and exactly the body the API expects, and that the read list
// shows who has read it and who has not.
//
// The API stub knows nobody, so the test answers the page's API requests itself
// (Playwright's page.route). The pages, their scripts, their stylesheets, and the policy
// header still come from nginx.
import { expect, test } from "@playwright/test";

/** A session for the Kitchen's manager, as GET /api/sessions/current answers it. */
const SESSION = {
  user: { id: "u1", display_name: "Ana Diaz", email: "ana@example.com", department_id: "d1" },
  company: { id: "c1", name: "Northwind Cafe", timezone: "America/Chicago" },
  permissions: ["schedule.view_self", "announcement.create"],
  expires_at: "2099-01-01T00:00:00Z",
  csrf_token: "test-token",
};

/** Text that would run a script if it were ever put on the page as HTML. */
const XSS = "<img src=x onerror=alert(1)>";

/** One managed announcement, as GET /api/announcements/managed sends it. */
const MANAGED = {
  id: "a1",
  audience: {
    type: "department",
    department_id: "d1",
    department_name: "Kitchen",
    team_id: null,
    team_name: null,
  },
  title: `Labels ${XSS}`,
  body: `Use **the new labels**. ${XSS}`,
  author: { id: "u1", display_name: "Ana Diaz" },
  posted_at: "2026-10-05T14:00:00Z",
  edited_at: null,
  archived: false,
  read_count: 1,
  audience_count: 2,
};

/**
 * Answer the page's API requests here, and watch the console for anything the policy
 * refused.
 * @param {import("@playwright/test").Page} page
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
  /** @type {{ body: unknown, token: string | null }[]} */
  const posts = [];

  await page.route("**/api/sessions/current", (route) => route.fulfill({ json: SESSION }));
  // Only the Kitchen and its Weekend Crew: what a Kitchen manager may post to.
  await page.route("**/api/announcements/audiences", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            type: "department",
            department_id: "d1",
            team_id: null,
            name: "Kitchen",
            department_name: null,
          },
          {
            type: "team",
            department_id: null,
            team_id: "t1",
            name: "Weekend Crew",
            department_name: "Kitchen",
          },
        ],
      },
    }),
  );
  await page.route("**/api/announcements/managed*", (route) =>
    route.fulfill({ json: { items: [MANAGED], next_cursor: null } }),
  );
  await page.route("**/api/announcements/a1/reads*", (route) =>
    route.fulfill({
      json: {
        items: [
          { id: "u1", display_name: "Ana Diaz", read_at: "2026-10-05T15:00:00Z" },
          { id: "u2", display_name: "Ben Okafor", read_at: null },
        ],
        next_cursor: null,
      },
    }),
  );
  // Posting: 201 with the new one; the body and the CSRF header are kept.
  await page.route("**/api/announcements", (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    posts.push({ body: request.postDataJSON(), token: request.headers()["x-csrf-token"] ?? null });
    return route.fulfill({ status: 201, json: { ...MANAGED, id: "a2" } });
  });
  return { refused, dialogs, posts };
}

test("a manager's text shows as text in the list, the preview, and the read list", async ({
  page,
}) => {
  const { refused, dialogs } = await stubApi(page);
  await page.goto("/pages/announcements-manage.html");

  const card = page.locator("#managed article");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".announcement__title")).toHaveText(`Labels ${XSS}`);
  await expect(card.locator(".announcement__body strong")).toHaveText("the new labels");
  await expect(card.locator(".managed__reads")).toHaveText("1 of 2 read");

  // Who has read it: by name, "Read <when>" in Chicago time, or "Not yet".
  await card.getByRole("button", { name: "Who has read it" }).click();
  const readers = page.getByRole("dialog", { name: "Who has read it" });
  await expect(readers.locator(".readers__item")).toHaveText([
    "Ana DiazRead Mon, Oct 5, 2026, 10:00 AM",
    "Ben OkaforNot yet",
  ]);
  await expect(readers).toContainText(`Labels ${XSS}`);
  await readers.getByRole("button", { name: "Close" }).click();

  // The preview as the manager types the payload.
  await page.getByRole("button", { name: "Post an announcement" }).click();
  const form = page.getByRole("dialog", { name: "Post an announcement" });
  await form.getByLabel("Title").fill(`Hi ${XSS}`);
  await form.getByLabel("Message").fill(`**Bold** ${XSS}`);
  const preview = form.getByRole("region", { name: "Preview" });
  await expect(preview.locator("strong")).toHaveText("Bold");
  await expect(preview).toContainText(XSS);

  // No image anywhere in the page's own content, no script ran, nothing refused.
  await expect(page.locator("main img, dialog img")).toHaveCount(0);
  expect(dialogs).toEqual([]);
  expect(refused).toEqual([]);
});

test("the form offers only the server's audiences and posts with the CSRF token", async ({
  page,
}) => {
  const { refused, posts } = await stubApi(page);
  // As from the home screen's "Post an announcement" link: the form opens at once.
  await page.goto("/pages/announcements-manage.html#post");

  const form = page.getByRole("dialog", { name: "Post an announcement" });
  const audience = form.getByLabel("Audience");
  await expect(audience.locator("option")).toHaveText([
    "Kitchen department",
    "Weekend Crew team (Kitchen)",
  ]);
  await audience.selectOption({ label: "Weekend Crew team (Kitchen)" });
  await form.getByLabel("Title").fill("Brunch");
  await form.getByLabel("Message").fill("Be in by **7:15**.\nThanks!");
  await form.getByRole("button", { name: "Post announcement" }).click();

  await expect(page.locator("#done")).toHaveText("Announcement posted.");
  expect(posts).toEqual([
    {
      body: {
        audience_type: "team",
        team_id: "t1",
        title: "Brunch",
        body: "Be in by **7:15**.\nThanks!",
      },
      token: "test-token",
    },
  ]);
  expect(refused).toEqual([]);
});

// Managing announcements (slice AN5): the audience choices, the form with its preview,
// posting, correcting only what changed, archiving, the read list, and the managed list's
// states. Every manager's text must reach the page as text, never as HTML (T5).
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../js/api/client.js";
import { loadPage } from "./page-html.js";

// Replace the data source, so each test decides what the "server" returns.
vi.mock("../../js/api/announcements.js", () => ({
  listAnnouncements: vi.fn(),
  markAnnouncementRead: vi.fn(),
  listAudiences: vi.fn(),
  postAnnouncement: vi.fn(),
  listManaged: vi.fn(),
  editAnnouncement: vi.fn(),
  archiveAnnouncement: vi.fn(),
  listReaders: vi.fn(),
}));
// The time zone comes from the session.
vi.mock("../../js/core/session.js", () => ({
  currentSession: () => ({ company: { timezone: "America/Chicago" } }),
  can: vi.fn(),
}));
// The page starts through the frame (session first); here each test calls the page's own
// loading directly, so the frame is replaced by a stub that does nothing.
vi.mock("../../js/components/app-shell.js", () => ({ startSignedInPage: vi.fn() }));

const api = await import("../../js/api/announcements.js");
const page = await import("../../js/pages/announcements-manage.js");
const { openFormDialog } = await import("../../js/components/form-dialog.js");

/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);

/** Text that would run a script if it were ever put on the page as HTML. */
const XSS = "<img src=x onerror=alert(1)>";

/** @type {import("../../js/api/announcements.js").AudienceChoice[]} */
const CHOICES = [
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
];

/**
 * One announcement as the managed list sends it.
 * @param {string} id
 * @param {Partial<import("../../js/api/announcements.js").ManagedAnnouncement>} [extra]
 * @returns {import("../../js/api/announcements.js").ManagedAnnouncement}
 */
function managed(id, extra = {}) {
  return {
    id,
    audience: {
      type: "department",
      department_id: "d1",
      department_name: "Kitchen",
      team_id: null,
      team_name: null,
    },
    title: `Title ${id}`,
    body: "Body",
    author: { id: "u1", display_name: "Ana Diaz" },
    posted_at: "2026-10-05T14:00:00Z",
    edited_at: null,
    archived: false,
    read_count: 12,
    audience_count: 30,
    ...extra,
  };
}

/** Let pending requests and their follow-ups settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const dialog = () => document.querySelector("dialog");
/** @param {string} name */
const field = (name) =>
  /** @type {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */ (
    document.querySelector(`dialog [name="${name}"]`)
  );
/**
 * Type into a field the way a person does (the value, then an input event).
 * @param {string} name
 * @param {string} value
 */
function type(name, value) {
  const input = field(name);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const submit = () =>
  /** @type {HTMLFormElement} */ (document.querySelector("dialog form")).requestSubmit();
/** @param {string} text */
const buttonNamed = (text) =>
  /** @type {HTMLButtonElement} */ (
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)
  );

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("the audience choices", () => {
  it("say who each audience is, a team with its department", () => {
    expect(
      page.choiceLabel({
        type: "company",
        department_id: null,
        team_id: null,
        name: null,
        department_name: null,
      }),
    ).toBe("Everyone in the company");
    expect(page.choiceLabel(CHOICES[0])).toBe("Kitchen department");
    expect(page.choiceLabel(CHOICES[1])).toBe("Weekend Crew team (Kitchen)");
  });

  it("send exactly the ID each type needs", () => {
    expect(page.audienceBody(CHOICES[0])).toEqual({
      audience_type: "department",
      department_id: "d1",
    });
    expect(page.audienceBody(CHOICES[1])).toEqual({ audience_type: "team", team_id: "t1" });
  });
});

describe("the preview", () => {
  it("shows bold as <strong> and HTML as the characters typed", () => {
    const box = document.createElement("div");
    box.append(...page.previewNodes({ title: `Hi ${XSS}`, body: "Stay **late**" }));
    expect(box.querySelector("strong")?.textContent).toBe("late");
    expect(box.querySelector("img")).toBeNull();
    expect(box.textContent).toContain(XSS);
  });

  it("says so when there is nothing yet", () => {
    const box = document.createElement("div");
    box.append(...page.previewNodes({ title: "", body: "" }));
    expect(box.textContent).toBe("Nothing to preview yet.");
  });
});

describe("the form popup's message field and preview", () => {
  it("labels a field named title, and the popup keeps its own name", () => {
    // A field's ID once matched the heading's ("form-dialog-title"), so the Title label
    // pointed at the heading and the popup lost its name.
    void openFormDialog({
      title: "Post",
      submitLabel: "Post",
      fields: [{ name: "title", label: "Title", type: "text" }],
      run: vi.fn(),
    });
    const input = field("title");
    expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("Title");
    const name = dialog()?.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(name)?.tagName).toBe("H2");
    expect(document.querySelectorAll(`[id="${input.id}"]`)).toHaveLength(1);
  });

  it("keeps line breaks, stops at the limit, and previews as the person types", async () => {
    const run = vi.fn().mockResolvedValue("saved");
    const result = openFormDialog({
      title: "Post",
      submitLabel: "Post",
      fields: [{ name: "body", label: "Message", type: "textarea", maxLength: 4000 }],
      preview: { label: "Preview", render: (values) => [document.createTextNode(values.body)] },
      run,
    });
    expect(field("body").tagName).toBe("TEXTAREA");
    expect(field("body").getAttribute("maxlength")).toBe("4000");
    type("body", "  Line one\nLine **two**  ");
    expect(document.querySelector('[aria-label="Preview"]')?.textContent).toContain(
      "Line one\nLine **two**",
    );
    submit();
    await expect(result).resolves.toBe("saved");
    expect(run).toHaveBeenCalledWith({ body: "Line one\nLine **two**" });
  });
});

describe("editing", () => {
  it("sends only the fields that changed", () => {
    const item = managed("a1");
    expect(page.changedFields(item, { title: item.title, body: "New" })).toEqual({ body: "New" });
    expect(page.changedFields(item, { title: item.title, body: item.body })).toEqual({});
  });
});

describe("the page", () => {
  /**
   * Load the real page with these answers, and wait for its first requests.
   * @param {{ choices?: unknown, items?: unknown[], hash?: string }} [answers]
   */
  async function show(answers = {}) {
    loadPage("announcements-manage.html");
    const choices = answers.choices ?? CHOICES;
    if (choices instanceof Error) asMock(api.listAudiences).mockRejectedValue(choices);
    else asMock(api.listAudiences).mockResolvedValue(choices);
    asMock(api.listManaged).mockResolvedValue({
      items: answers.items ?? [managed("a1")],
      next_cursor: null,
    });
    await page.showManage(answers.hash ?? "");
  }

  it("lists the managed ones with their read counts, archived ones without changes", async () => {
    await show({ items: [managed("a1"), managed("a2", { archived: true, title: XSS })] });
    const cards = document.querySelectorAll("#managed article");
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector(".managed__reads")?.textContent).toBe("12 of 30 read");
    const actions = [...cards[0].querySelectorAll("button")].map((b) => b.textContent);
    expect(actions).toEqual(["Who has read it", "Correct", "Archive"]);
    // Archived: only who read it, the word "Archived", and its title as plain text.
    expect([...cards[1].querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Who has read it",
    ]);
    expect(cards[1].textContent).toContain("Archived");
    expect(cards[1].querySelector("img")).toBeNull();
    expect(cards[1].textContent).toContain(XSS);
  });

  it("asks for archived ones only with Show archived, starting again from the newest", async () => {
    await show();
    expect(api.listManaged).toHaveBeenLastCalledWith({
      cursor: null,
      limit: page.PAGE_SIZE,
      includeArchived: false,
    });
    const box = /** @type {HTMLInputElement} */ (document.getElementById("show-archived"));
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await settle();
    expect(api.listManaged).toHaveBeenLastCalledWith({
      cursor: null,
      limit: page.PAGE_SIZE,
      includeArchived: true,
    });
  });

  it("offers posting only with somewhere to post to", async () => {
    await show({ choices: new ApiError(403, { title: "Forbidden" }) });
    expect(document.getElementById("post")?.hidden).toBe(true);
    await show({ choices: [] });
    expect(document.getElementById("post")?.hidden).toBe(true);
    await show();
    expect(document.getElementById("post")?.hidden).toBe(false);
  });

  it("says so when the list is refused", async () => {
    loadPage("announcements-manage.html");
    asMock(api.listAudiences).mockResolvedValue([]);
    asMock(api.listManaged).mockRejectedValue(new ApiError(403, { title: "Forbidden" }));
    await page.showManage("");
    expect(document.getElementById("status")?.textContent).toBe("Problem: Forbidden");
  });

  it("posts to the audience chosen from the server's list, then shows the new list", async () => {
    await show();
    asMock(api.postAnnouncement).mockResolvedValue(managed("new"));
    buttonNamed("Post an announcement").click();
    // Only the server's choices are offered.
    const options = [...field("audience").querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Kitchen department", "Weekend Crew team (Kitchen)"]);
    const select = /** @type {HTMLSelectElement} */ (field("audience"));
    select.value = "1";
    select.dispatchEvent(new Event("change"));
    type("title", "Brunch");
    type("body", "Be in by **7:15**");
    // The preview shows the bold part as readers will see it.
    expect(dialog()?.querySelector('[aria-label="Preview"] strong')?.textContent).toBe("7:15");
    submit();
    await settle();
    expect(api.postAnnouncement).toHaveBeenCalledWith({
      audience_type: "team",
      team_id: "t1",
      title: "Brunch",
      body: "Be in by **7:15**",
    });
    await settle();
    expect(document.getElementById("done")?.textContent).toBe("Announcement posted.");
    expect(api.listManaged).toHaveBeenCalledTimes(2);
  });

  it("shows the server's reason in the form and keeps what was typed", async () => {
    await show();
    asMock(api.postAnnouncement).mockRejectedValue(
      new ApiError(409, {
        title: "Conflict",
        detail: "This department or team is archived. Announcements cannot be posted to it.",
      }),
    );
    buttonNamed("Post an announcement").click();
    type("title", "Brunch");
    type("body", "Text");
    submit();
    await settle();
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain("archived");
    expect(field("title").value).toBe("Brunch");
  });

  it("opens the form at once when the home screen's link asks for it", async () => {
    await show({ hash: "#post" });
    expect(dialog()?.textContent).toContain("Post an announcement");
  });

  it("corrects only what changed, and archives after asking", async () => {
    await show();
    asMock(api.editAnnouncement).mockResolvedValue(managed("a1", { body: "Fixed" }));
    buttonNamed("Correct").click();
    expect(field("title").value).toBe("Title a1");
    type("body", "Fixed");
    submit();
    await settle();
    expect(api.editAnnouncement).toHaveBeenCalledWith("a1", { body: "Fixed" });
    await settle();
    expect(document.getElementById("done")?.textContent).toBe("Correction saved.");

    asMock(api.archiveAnnouncement).mockResolvedValue(managed("a1", { archived: true }));
    buttonNamed("Archive").click();
    // Nothing is sent before the question is answered.
    expect(api.archiveAnnouncement).not.toHaveBeenCalled();
    /** @type {HTMLButtonElement} */ (document.querySelector("dialog .button--primary")).click();
    await settle();
    expect(api.archiveAnnouncement).toHaveBeenCalledWith("a1");
  });

  it("sends nothing for a correction that changes nothing", async () => {
    await show();
    buttonNamed("Correct").click();
    submit();
    await settle();
    expect(api.editAnnouncement).not.toHaveBeenCalled();
  });

  it("shows who has read it and who not yet, a page at a time", async () => {
    await show();
    asMock(api.listReaders)
      .mockResolvedValueOnce({
        items: [
          { id: "u1", display_name: "Ana Diaz", read_at: "2026-10-05T15:00:00Z" },
          { id: "u2", display_name: `Ben ${XSS}`, read_at: null },
        ],
        next_cursor: "u2",
      })
      .mockResolvedValueOnce({
        items: [{ id: "u3", display_name: "Cara Lund", read_at: null }],
        next_cursor: null,
      });
    buttonNamed("Who has read it").click();
    await settle();
    const rows = () => [...document.querySelectorAll("dialog .readers__item")];
    expect(rows().map((r) => r.querySelector(".readers__when")?.textContent)).toEqual([
      "Read Mon, Oct 5, 2026, 10:00 AM",
      "Not yet",
    ]);
    expect(dialog()?.querySelector("img")).toBeNull();
    expect(dialog()?.textContent).toContain("12 of 30 read");
    buttonNamed("Load more people").click();
    await settle();
    expect(api.listReaders).toHaveBeenLastCalledWith("a1", {
      cursor: "u2",
      limit: page.READERS_PAGE_SIZE,
    });
    expect(rows()).toHaveLength(3);
    expect(buttonNamed("Load more people").hidden).toBe(true);
  });
});

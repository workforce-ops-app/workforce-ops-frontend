// The announcements page and the newest announcements on My week: paging, empty and error
// states, and the requests sent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";

// Replace the data source, so each test decides what the "server" returns.
vi.mock("../../js/api/announcements.js", () => ({
  listAnnouncements: vi.fn(),
  markAnnouncementRead: vi.fn(),
}));
// My week also loads shifts; these tests only look at its announcements.
vi.mock("../../js/api/shifts.js", () => ({ listShifts: vi.fn() }));
// The time zone comes from the session.
vi.mock("../../js/core/session.js", () => ({ currentSession: vi.fn(), can: vi.fn() }));
// The pages start through the frame (session first); here each test calls the page's own
// loading directly, so the frame is replaced by a stub that does nothing.
vi.mock("../../js/components/app-shell.js", () => ({ startSignedInPage: vi.fn() }));
const { listAnnouncements } = await import("../../js/api/announcements.js");
const { currentSession } = await import("../../js/core/session.js");
const { showAnnouncements, PAGE_SIZE } = await import("../../js/pages/announcements.js");
const { showHomeAnnouncements, HOME_ANNOUNCEMENTS } = await import("../../js/pages/my-shifts.js");
/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);
const listMock = asMock(listAnnouncements);

/**
 * An announcement as the API sends it.
 * @param {string} id
 * @param {string} title
 * @returns {import("../../js/api/announcements.js").Announcement}
 */
function announcement(id, title) {
  return {
    id,
    audience: {
      type: "company",
      department_id: null,
      department_name: null,
      team_id: null,
      team_name: null,
    },
    title,
    body: "Body",
    author: { id: "u9", display_name: "Maria Lopez" },
    posted_at: "2026-10-05T14:00:00Z",
    edited_at: null,
    archived: false,
    read: false,
  };
}

/**
 * Build the elements a page needs (with DOM calls, not HTML).
 * @param {[string, string][]} parts tag and ID of each
 */
function page(parts) {
  document.body.replaceChildren(
    ...parts.map(([tag, id]) => {
      const element = document.createElement(tag);
      element.id = id;
      return element;
    }),
  );
}

const text = (/** @type {string} */ id) => document.getElementById(id)?.textContent;
const titles = (/** @type {string} */ id) =>
  [...document.querySelectorAll(`#${id} .announcement__title`)].map((t) => t.textContent);
const more = () => /** @type {HTMLButtonElement} */ (document.getElementById("load-more"));
/** Let the click's request settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  listMock.mockReset();
  asMock(currentSession).mockReturnValue({ company: { timezone: "America/Chicago" } });
});
afterEach(() => document.body.replaceChildren());

describe("Announcements page", () => {
  beforeEach(() =>
    page([
      ["p", "status"],
      ["ul", "announcements"],
      ["button", "load-more"],
    ]),
  );

  it("shows the first page newest first, as the server sent it, one list item each", async () => {
    listMock.mockResolvedValue({
      items: [announcement("a2", "Newer"), announcement("a1", "Older")],
      next_cursor: null,
    });

    await showAnnouncements();

    expect(listMock).toHaveBeenCalledWith({ cursor: null, limit: PAGE_SIZE });
    expect(titles("announcements")).toEqual(["Newer", "Older"]);
    expect(document.querySelectorAll("#announcements > li > article")).toHaveLength(2);
    // Under the page's h1, each title is an h2.
    expect(document.querySelectorAll("#announcements h2 > button")).toHaveLength(2);
    expect(text("status")).toBe("");
    expect(more().hidden).toBe(true);
  });

  it("loads the next page with the server's cursor, then stops", async () => {
    listMock
      .mockResolvedValueOnce({ items: [announcement("a3", "Third")], next_cursor: "c1" })
      .mockResolvedValueOnce({ items: [announcement("a2", "Second")], next_cursor: "c2" })
      .mockResolvedValueOnce({ items: [announcement("a1", "First")], next_cursor: null });

    await showAnnouncements();
    expect(more().hidden).toBe(false);

    more().click();
    await settle();
    expect(listMock).toHaveBeenLastCalledWith({ cursor: "c1", limit: PAGE_SIZE });
    // The new ones go under the ones already shown, and focus moves to the first new one.
    expect(titles("announcements")).toEqual(["Third", "Second"]);
    expect(document.activeElement?.closest("li")).toBe(
      document.querySelectorAll("#announcements > li")[1],
    );

    more().click();
    await settle();
    expect(listMock).toHaveBeenLastCalledWith({ cursor: "c2", limit: PAGE_SIZE });
    expect(titles("announcements")).toEqual(["Third", "Second", "First"]);
    // No cursor left: no more button.
    expect(more().hidden).toBe(true);
  });

  it("sends one request per click, with the button off while it loads", async () => {
    listMock.mockResolvedValueOnce({ items: [announcement("a2", "Second")], next_cursor: "c1" });
    await showAnnouncements();
    /** @type {(value: unknown) => void} */
    let answer = () => {};
    listMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

    more().click();
    expect(more().disabled).toBe(true);
    expect(more().textContent).toBe("Loading…");
    more().click();
    answer({ items: [announcement("a1", "First")], next_cursor: null });
    await settle();

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(more().disabled).toBe(false);
  });

  it("keeps the list and the button when the next page fails, so it can be tried again", async () => {
    listMock
      .mockResolvedValueOnce({ items: [announcement("a2", "Second")], next_cursor: "c1" })
      .mockRejectedValueOnce(new NetworkError(new TypeError("Failed to fetch")));
    await showAnnouncements();

    more().click();
    await settle();

    expect(text("status")).toBe("Problem: the server could not be reached");
    expect(titles("announcements")).toEqual(["Second"]);
    expect(more().hidden).toBe(false);
    expect(more().disabled).toBe(false);
  });

  it("says when there are none", async () => {
    listMock.mockResolvedValue({ items: [], next_cursor: null });

    await showAnnouncements();

    expect(text("status")).toBe("No announcements yet.");
  });

  it("shows an error answer's title", async () => {
    listMock.mockRejectedValue(new ApiError(500, { title: "Internal Server Error" }));

    await showAnnouncements();

    expect(text("status")).toBe("Problem: Internal Server Error");
    expect(more().hidden).toBe(true);
  });

  it("does not disguise a bug as a network problem", async () => {
    listMock.mockRejectedValue(new TypeError("a bug"));

    await expect(showAnnouncements()).rejects.toThrow("a bug");
    expect(text("status")).toBe("Problem: this page could not load");
  });
});

describe("Newest announcements on My week", () => {
  beforeEach(() =>
    page([
      ["p", "announcements-status"],
      ["ul", "home-announcements"],
    ]),
  );

  it("asks for only the newest few and shows them under the section heading", async () => {
    listMock.mockResolvedValue({
      items: [announcement("a2", "Newer"), announcement("a1", "Older")],
      next_cursor: "more",
    });

    await showHomeAnnouncements();

    expect(listMock).toHaveBeenCalledWith({ limit: HOME_ANNOUNCEMENTS });
    expect(titles("home-announcements")).toEqual(["Newer", "Older"]);
    // Under the section's h2, each title is an h3.
    expect(document.querySelectorAll("#home-announcements h3 > button")).toHaveLength(2);
    expect(text("announcements-status")).toBe("");
  });

  it("says when there are none", async () => {
    listMock.mockResolvedValue({ items: [], next_cursor: null });

    await showHomeAnnouncements();

    expect(text("announcements-status")).toBe("No announcements yet.");
  });

  it("explains a failure in plain words", async () => {
    listMock.mockRejectedValue(new NetworkError(new TypeError("Failed to fetch")));

    await showHomeAnnouncements();

    expect(text("announcements-status")).toBe("Problem: the server could not be reached");
  });

  it("does not disguise a bug as a network problem", async () => {
    listMock.mockRejectedValue(new TypeError("a bug"));

    await expect(showHomeAnnouncements()).rejects.toThrow("a bug");
    expect(text("announcements-status")).toBe("Problem: announcements could not load");
  });
});

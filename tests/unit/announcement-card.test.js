// One announcement card: what it shows, the unread label, and the read mark sent when it
// is opened (and only then, and only once).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";

// Replace the request, so each test decides what the "server" answers to the read mark.
vi.mock("../../js/api/announcements.js", () => ({ markAnnouncementRead: vi.fn() }));
// The loaded session, for the workplace's time zone.
vi.mock("../../js/core/session.js", () => ({ currentSession: vi.fn() }));
const { markAnnouncementRead } = await import("../../js/api/announcements.js");
const { currentSession } = await import("../../js/core/session.js");
const { announcementCard, audienceLabel, workplaceTimeZone } =
  await import("../../js/components/announcement-card.js");
/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);
const markMock = asMock(markAnnouncementRead);
const sessionMock = asMock(currentSession);

/**
 * An announcement as the API sends it: unread, for the Kitchen, posted 9:00 AM in Chicago.
 * @param {Partial<import("../../js/api/announcements.js").Announcement>} [overrides]
 * @returns {import("../../js/api/announcements.js").Announcement}
 */
function announcement(overrides = {}) {
  return {
    id: "a1",
    audience: {
      type: "department",
      department_id: "d1",
      department_name: "Kitchen",
      team_id: null,
      team_name: null,
    },
    title: "Inventory **tonight**",
    body: "Please stay late.\nPizza provided.",
    author: { id: "u9", display_name: "Maria Lopez" },
    posted_at: "2026-10-05T14:00:00Z",
    edited_at: null,
    archived: false,
    read: false,
    ...overrides,
  };
}

/**
 * A card on the page, as the lists put it there.
 * @param {import("../../js/api/announcements.js").Announcement} item
 */
function show(item) {
  const card = announcementCard(item, { timeZone: "America/Chicago" });
  document.body.append(card);
  const toggle = /** @type {HTMLButtonElement} */ (card.querySelector("button"));
  return { card, toggle };
}

/** Let the read mark's promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  markMock.mockReset().mockResolvedValue(null);
  sessionMock.mockReset();
});
afterEach(() => document.body.replaceChildren());

describe("announcementCard", () => {
  it("shows the title in a heading button, who, to whom, and when", () => {
    const { card, toggle } = show(announcement());

    expect(card.tagName).toBe("ARTICLE");
    expect(card.querySelector("h2 > button")).toBe(toggle);
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.querySelector(".announcement__title")?.textContent).toBe("Inventory tonight");
    expect(toggle.querySelector("strong")?.textContent).toBe("tonight");
    const meta = card.querySelector(".announcement__meta");
    expect(meta?.textContent).toBe(
      "From Maria Lopez · To Kitchen department · Mon, Oct 5, 2026, 9:00 AM",
    );
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-05T14:00:00Z");
  });

  it("uses an h3 when asked (under the home screen's section heading)", () => {
    const card = announcementCard(announcement(), {
      timeZone: "America/Chicago",
      headingLevel: 3,
    });

    expect(card.querySelector("h3 > button")).not.toBeNull();
    expect(card.querySelector("h2")).toBeNull();
  });

  it("says Edited for an announcement corrected after posting", () => {
    const { card } = show(announcement({ edited_at: "2026-10-06T10:00:00Z" }));

    expect(card.querySelector(".announcement__edited")?.textContent).toBe("Edited");
    expect(card.querySelector(".announcement__meta")?.textContent).toContain("· Edited");
  });

  it("marks an unread one in words, part of the button's name", () => {
    const { card, toggle } = show(announcement());

    expect(card.classList.contains("announcement--unread")).toBe(true);
    expect(toggle.querySelector(".announcement__unread")?.textContent).toBe("Unread");
    expect(toggle.textContent?.startsWith("Unread")).toBe(true);
  });

  it("shows no label for one already read", () => {
    const { card } = show(announcement({ read: true }));

    expect(card.classList.contains("announcement--unread")).toBe(false);
    expect(card.querySelector(".announcement__unread")).toBeNull();
  });

  it("keeps the message closed until the button opens it, with line breaks kept", () => {
    const { card, toggle } = show(announcement());
    const body = /** @type {HTMLElement} */ (card.querySelector(".announcement__body"));

    expect(body.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(body.id);

    toggle.click();
    expect(body.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body.textContent).toBe("Please stay late.\nPizza provided.");
    expect(body.classList.contains("announcement-text")).toBe(true);

    toggle.click();
    expect(body.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("gives every card's message its own ID", () => {
    const first = show(announcement()).card.querySelector(".announcement__body")?.id;
    const second = show(announcement({ id: "a2" })).card.querySelector(".announcement__body")?.id;

    expect(first).not.toBe(second);
  });

  it("marks it read when opened, then drops the label", async () => {
    const { card, toggle } = show(announcement());

    // Nothing is sent just for showing it.
    expect(markMock).not.toHaveBeenCalled();
    toggle.click();
    await settle();

    expect(markMock).toHaveBeenCalledWith("a1");
    expect(card.querySelector(".announcement__unread")).toBeNull();
    expect(card.classList.contains("announcement--unread")).toBe(false);
  });

  it("sends the mark once, however often it is opened", async () => {
    const { toggle } = show(announcement());

    // A quick double click (open, close, open) while the first mark is on its way.
    toggle.click();
    toggle.click();
    toggle.click();
    await settle();
    toggle.click();
    toggle.click();
    await settle();

    expect(markMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for one already read", async () => {
    const { toggle } = show(announcement({ read: true }));

    toggle.click();
    await settle();

    expect(markMock).not.toHaveBeenCalled();
  });

  it.each([
    ["the server cannot be reached", new NetworkError(new TypeError("Failed to fetch"))],
    ["the server refuses", new ApiError(404, { title: "Not Found" })],
  ])("stays unread and tries again next time when %s", async (_, error) => {
    markMock.mockRejectedValueOnce(error);
    const { card, toggle } = show(announcement());

    toggle.click();
    await settle();
    // The message is shown anyway; only the mark failed.
    expect(/** @type {HTMLElement} */ (card.querySelector(".announcement__body")).hidden).toBe(
      false,
    );
    expect(card.querySelector(".announcement__unread")).not.toBeNull();

    // Closed and opened again: a second try, which works.
    toggle.click();
    toggle.click();
    await settle();
    expect(markMock).toHaveBeenCalledTimes(2);
    expect(card.querySelector(".announcement__unread")).toBeNull();
  });

  it("shows a title and body with HTML in them as text", () => {
    const { card, toggle } = show(
      announcement({
        title: "<script>alert(1)</script>",
        body: "<img src=x onerror=alert(1)> **<b>x</b>**",
        author: { id: "u9", display_name: "<img src=x onerror=alert(2)>" },
      }),
    );
    toggle.click();

    expect(card.querySelector("script")).toBeNull();
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("b")).toBeNull();
    expect(toggle.textContent).toContain("<script>alert(1)</script>");
    expect(card.querySelector(".announcement__body")?.textContent).toBe(
      "<img src=x onerror=alert(1)> <b>x</b>",
    );
    expect(card.querySelector(".announcement__meta")?.textContent).toContain(
      "From <img src=x onerror=alert(2)>",
    );
  });
});

describe("audienceLabel", () => {
  it("names the company, a department, or a team", () => {
    const base = { department_id: null, department_name: null, team_id: null, team_name: null };

    expect(audienceLabel({ ...base, type: "company" })).toBe("Everyone");
    expect(
      audienceLabel({
        ...base,
        type: "department",
        department_id: "d1",
        department_name: "Kitchen",
      }),
    ).toBe("Kitchen department");
    // A team audience carries no department (department_id is null).
    expect(audienceLabel({ ...base, type: "team", team_id: "t1", team_name: "Weekend Crew" })).toBe(
      "Weekend Crew team",
    );
  });
});

describe("workplaceTimeZone", () => {
  it("is the company's zone from the session", () => {
    sessionMock.mockReturnValue({ company: { timezone: "America/Denver" } });

    expect(workplaceTimeZone()).toBe("America/Denver");
  });

  it("falls back to the browser's zone before the session has loaded", () => {
    sessionMock.mockReturnValue(null);

    expect(workplaceTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

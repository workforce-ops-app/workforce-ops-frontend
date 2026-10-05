// The two schedule pages: what they show, and how they handle failures.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";

// Replace the data source, so each test decides what the "server" returns.
vi.mock("../../js/api/shifts.js", () => ({ listShifts: vi.fn() }));
const { listShifts } = await import("../../js/api/shifts.js");
const { showMyShifts } = await import("../../js/pages/my-shifts.js");
const { showWeek } = await import("../../js/pages/schedule.js");
const mocked = /** @type {import("vitest").Mock} */ (/** @type {unknown} */ (listShifts));

/**
 * A shift in Chicago on the given day.
 * @param {string} day "YYYY-MM-DD"
 * @param {object} [overrides]
 */
function shiftOn(day, overrides = {}) {
  return {
    id: `s-${day}`,
    department: { id: "d1", name: "Kitchen" },
    employee: { id: "u1", display_name: "Ana Diaz" },
    starts_at: `${day}T14:00:00Z`,
    ends_at: `${day}T22:00:00Z`,
    timezone: "America/Chicago",
    status: "scheduled",
    details: "Prep line",
    notes: null,
    event_name: null,
    event_description: null,
    ...overrides,
  };
}

/**
 * Build the elements a page needs (with DOM calls, not HTML).
 * @param {string[]} ids
 * @param {Record<string, string>} [tags] a different tag per id, default div
 */
function page(ids, tags = {}) {
  document.body.replaceChildren(
    ...ids.map((id) => {
      const element = document.createElement(tags[id] ?? "div");
      element.id = id;
      return element;
    }),
  );
}

// Braces matter: a function returned from beforeEach runs as a cleanup step afterwards,
// and mockReset() returns the mock itself, which would then be called once more.
beforeEach(() => {
  mocked.mockReset();
});
afterEach(() => document.body.replaceChildren());

describe("My shifts", () => {
  beforeEach(() => page(["status", "days"]));

  it("asks only for my shifts and shows one section per day", async () => {
    mocked.mockResolvedValue([shiftOn("2026-10-05"), shiftOn("2026-10-07")]);

    await showMyShifts();

    expect(mocked.mock.calls[0][0].mine).toBe(true);
    expect(document.querySelectorAll("#days .day")).toHaveLength(2);
    expect(document.getElementById("days")?.textContent).toContain("Kitchen");
  });

  it("says so when nothing is coming up", async () => {
    mocked.mockResolvedValue([]);

    await showMyShifts();

    expect(document.getElementById("status")?.textContent).toContain("No upcoming shifts");
  });

  it("keeps a malicious note as text on the page", async () => {
    mocked.mockResolvedValue([shiftOn("2026-10-05", { notes: "<script>alert(1)</script>" })]);

    await showMyShifts();

    expect(document.querySelector("#days script")).toBeNull();
    expect(document.getElementById("days")?.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("Department week", () => {
  beforeEach(() =>
    page(["title", "status", "week", "previous-week", "next-week"], {
      "previous-week": "a",
      "next-week": "a",
    }),
  );

  it("shows all seven days of the requested week, open shifts highlighted", async () => {
    mocked.mockResolvedValue([
      shiftOn("2026-10-05"),
      shiftOn("2026-10-08", { status: "open", employee: null }),
    ]);

    await showWeek("?week=2026-10-07&department=d1");

    // Any day of the week shows that week, Monday to Sunday.
    expect(mocked.mock.calls[0][0]).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
      departmentId: "d1",
    });
    expect(document.querySelectorAll("#week .day")).toHaveLength(7);
    expect(document.querySelectorAll("#week .shift-card--open")).toHaveLength(1);
    expect(document.getElementById("title")?.textContent).toBe(
      "Kitchen: week of Monday, October 5",
    );
  });

  it("links to the weeks before and after, keeping the department", async () => {
    mocked.mockResolvedValue([]);

    await showWeek("?week=2026-10-05&department=d1");

    expect(document.getElementById("previous-week")?.getAttribute("href")).toBe(
      "?week=2026-09-28&department=d1",
    );
    expect(document.getElementById("next-week")?.getAttribute("href")).toBe(
      "?week=2026-10-12&department=d1",
    );
  });

  it("ignores a malformed week and shows the current one", async () => {
    mocked.mockResolvedValue([]);

    await showWeek("?week=<script>");

    expect(mocked.mock.calls[0][0].from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(document.getElementById("title")?.textContent).not.toContain("<script>");
  });

  it("says the server could not be reached on a network failure", async () => {
    mocked.mockRejectedValue(new NetworkError(new TypeError("Failed to fetch")));

    await showWeek("");

    expect(document.getElementById("status")?.textContent).toBe(
      "Problem: the server could not be reached",
    );
  });

  it("shows an error answer's title", async () => {
    mocked.mockRejectedValue(new ApiError(403, { title: "Forbidden" }));

    await showWeek("");

    expect(document.getElementById("status")?.textContent).toBe("Problem: Forbidden");
  });

  it("does not disguise a bug as a network problem", async () => {
    mocked.mockRejectedValue(new TypeError("a bug"));

    await expect(showWeek("")).rejects.toThrow("a bug");
    expect(document.getElementById("status")?.textContent).toBe(
      "Problem: this page could not load",
    );
  });
});

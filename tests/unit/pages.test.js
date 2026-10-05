// The two schedule pages: what they show, and how they handle failures.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";

// Replace the data source, so each test decides what the "server" returns.
vi.mock("../../js/api/shifts.js", () => ({ listShifts: vi.fn() }));
const { listShifts } = await import("../../js/api/shifts.js");
const { formatHours, showMyWeek } = await import("../../js/pages/my-shifts.js");
const { showWeek } = await import("../../js/pages/schedule.js");
const mocked = /** @type {import("vitest").Mock} */ (/** @type {unknown} */ (listShifts));

/**
 * A shift in Chicago on the given day, 9:00 to 17:00 local time.
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
 */
function page(ids) {
  document.body.replaceChildren(
    ...ids.map((id) => {
      const element = document.createElement(id.endsWith("-week") ? "a" : "div");
      element.id = id;
      return element;
    }),
  );
}

const text = (/** @type {string} */ id) => document.getElementById(id)?.textContent;

// Braces matter: a function returned from beforeEach runs as a cleanup step afterwards,
// and mockReset() returns the mock itself, which would then be called once more.
beforeEach(() => {
  mocked.mockReset();
});
afterEach(() => document.body.replaceChildren());

describe("My week", () => {
  beforeEach(() => page(["week-range", "previous-week", "next-week", "status", "days", "summary"]));

  it("asks for my shifts of the week and shows a card for every day", async () => {
    mocked.mockResolvedValue([shiftOn("2026-10-05"), shiftOn("2026-10-07")]);

    await showMyWeek("?week=2026-10-06");

    expect(mocked.mock.calls[0][0]).toEqual({ from: "2026-10-05", to: "2026-10-11", mine: true });
    expect(document.querySelectorAll("#days .day-card")).toHaveLength(7);
    expect(document.querySelectorAll("#days .shift--none")).toHaveLength(5);
    expect(text("week-range")).toBe("Oct 5 to Oct 11");
  });

  it("adds up the hours scheduled", async () => {
    mocked.mockResolvedValue([shiftOn("2026-10-05"), shiftOn("2026-10-07")]);

    await showMyWeek("?week=2026-10-05");

    expect(text("summary")).toBe("Time scheduled: 16 hours");
    expect(document.getElementById("summary")?.hidden).toBe(false);
  });

  it("links to the weeks before and after", async () => {
    mocked.mockResolvedValue([]);

    await showMyWeek("?week=2026-10-05");

    expect(document.getElementById("previous-week")?.getAttribute("href")).toBe("?week=2026-09-28");
    expect(document.getElementById("next-week")?.getAttribute("href")).toBe("?week=2026-10-12");
  });

  it("keeps a malicious note as text on the page", async () => {
    mocked.mockResolvedValue([shiftOn("2026-10-05", { notes: "<script>alert(1)</script>" })]);

    await showMyWeek("?week=2026-10-05");

    expect(document.querySelector("#days script")).toBeNull();
    expect(text("days")).toContain("<script>alert(1)</script>");
  });

  it("hides the total and explains a network failure", async () => {
    mocked.mockRejectedValue(new NetworkError(new TypeError("Failed to fetch")));

    await showMyWeek("");

    expect(text("status")).toBe("Problem: the server could not be reached");
    expect(document.getElementById("summary")?.hidden).toBe(true);
  });

  it("does not disguise a bug as a network problem", async () => {
    mocked.mockRejectedValue(new TypeError("a bug"));

    await expect(showMyWeek("")).rejects.toThrow("a bug");
    expect(text("status")).toBe("Problem: this page could not load");
  });
});

describe("formatHours", () => {
  it("says hours the way people do", () => {
    expect(formatHours(1)).toBe("1 hour");
    expect(formatHours(7.5)).toBe("7.5 hours");
    expect(formatHours(24)).toBe("24 hours");
    expect(formatHours(0)).toBe("0 hours");
  });
});

describe("Department week", () => {
  beforeEach(() => page(["title", "week-range", "previous-week", "next-week", "status", "days"]));

  it("shows all seven days with who works each shift, open shifts marked", async () => {
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
    expect(document.querySelectorAll("#days .day-card")).toHaveLength(7);
    expect(document.querySelectorAll("#days .shift--open")).toHaveLength(1);
    expect(text("days")).toContain("Ana Diaz");
    expect(text("title")).toBe("Kitchen");
  });

  it("links to other weeks, keeping the department", async () => {
    mocked.mockResolvedValue([]);

    await showWeek("?week=2026-10-05&department=d1");

    expect(document.getElementById("next-week")?.getAttribute("href")).toBe(
      "?week=2026-10-12&department=d1",
    );
  });

  it("shows an error answer's title", async () => {
    mocked.mockRejectedValue(new ApiError(403, { title: "Forbidden" }));

    await showWeek("");

    expect(text("status")).toBe("Problem: Forbidden");
  });

  it("does not disguise a bug as a network problem", async () => {
    mocked.mockRejectedValue(new TypeError("a bug"));

    await expect(showWeek("")).rejects.toThrow("a bug");
    expect(text("status")).toBe("Problem: this page could not load");
  });
});

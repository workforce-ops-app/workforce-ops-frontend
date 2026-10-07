// The two schedule pages: what they show, and how they handle failures.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";

// Replace the data source, so each test decides what the "server" returns.
vi.mock("../../js/api/shifts.js", () => ({
  listShifts: vi.fn(),
  listDepartments: vi.fn(),
  myDepartmentId: vi.fn(),
}));
const { listShifts, listDepartments, myDepartmentId } = await import("../../js/api/shifts.js");
const { showMyWeek } = await import("../../js/pages/my-shifts.js");
const { showWeek, weekStats } = await import("../../js/pages/schedule.js");
const { mondayOf } = await import("../../js/core/time.js");
const { today } = await import("../../js/core/week.js");
/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);
const mocked = asMock(listShifts);
const departmentsMock = asMock(listDepartments);
const myDepartmentMock = asMock(myDepartmentId);

/**
 * A shift in Chicago on the given day, 9:00 to 17:00 local time.
 * @param {string} day "YYYY-MM-DD"
 * @param {Partial<import("../../js/api/shifts.js").Shift>} [overrides]
 * @returns {import("../../js/api/shifts.js").Shift}
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
  // The company's departments, and the signed-in person's own one (Kitchen).
  departmentsMock.mockReset().mockResolvedValue([
    { id: "d1", name: "Kitchen" },
    { id: "d2", name: "Front of House" },
  ]);
  myDepartmentMock.mockReset().mockResolvedValue("d1");
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

  it("keeps a malicious note as text, shown only when the shift is opened", async () => {
    mocked.mockResolvedValue([shiftOn("2026-10-05", { notes: "<script>alert(1)</script>" })]);

    await showMyWeek("?week=2026-10-05");

    // The week shows the time only; the note waits for the popup.
    expect(text("days")).not.toContain("<script>");
    /** @type {HTMLButtonElement | null} */ (document.querySelector("#days button.shift"))?.click();
    const popup = document.querySelector("dialog.shift-dialog");
    expect(document.querySelector("script")).toBeNull();
    expect(popup?.textContent).toContain("<script>alert(1)</script>");
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

  it("fills the grid and the week's numbers when the page has them", async () => {
    page(["title", "week-range", "previous-week", "next-week", "status", "days", "grid", "stats"]);
    mocked.mockResolvedValue([
      shiftOn("2026-10-05"),
      shiftOn("2026-10-08", { status: "open", employee: null }),
    ]);

    await showWeek("?week=2026-10-05&department=d1");

    expect(document.querySelectorAll("#grid table tbody tr")).toHaveLength(2);
    expect(document.getElementById("stats")?.hidden).toBe(false);
    expect(document.querySelectorAll("#stats .stat")).toHaveLength(4);
  });

  it("hides the week's numbers when the week cannot load", async () => {
    page(["title", "week-range", "previous-week", "next-week", "status", "days", "grid", "stats"]);
    mocked.mockRejectedValue(new NetworkError(new TypeError("Failed to fetch")));

    await showWeek("");

    expect(document.getElementById("stats")?.hidden).toBe(true);
  });

  it("links to other weeks, keeping the department", async () => {
    mocked.mockResolvedValue([]);

    await showWeek("?week=2026-10-05&department=d1");

    expect(document.getElementById("next-week")?.getAttribute("href")).toBe(
      "?week=2026-10-12&department=d1",
    );
  });

  it("shows the person's own department when the address names none", async () => {
    mocked.mockResolvedValue([]);

    await showWeek("?week=2026-10-05");

    // One department only, so shifts of different departments are never mixed.
    expect(mocked.mock.calls[0][0]).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
      departmentId: "d1",
    });
    expect(text("title")).toBe("Kitchen");
  });

  it("names a chosen department even when its week has no shifts", async () => {
    mocked.mockResolvedValue([]);

    await showWeek("?week=2026-10-05&department=d2");

    expect(mocked.mock.calls[0][0].departmentId).toBe("d2");
    expect(text("title")).toBe("Front of House");
  });

  it("keeps the plain heading for a department it does not know", async () => {
    mocked.mockResolvedValue([]);

    await showWeek("?week=2026-10-05&department=unknown");

    expect(text("title")).toBe("Department week");
  });

  it("uses the first department for someone without a home department", async () => {
    myDepartmentMock.mockResolvedValue(null);
    mocked.mockResolvedValue([]);

    await showWeek("?week=2026-10-05");

    expect(mocked.mock.calls[0][0].departmentId).toBe("d1");
  });

  it("falls back to the current week for a day that does not exist", async () => {
    mocked.mockResolvedValue([]);

    // Well formed but impossible: the page shows this week instead of failing.
    await showWeek("?week=2026-99-99");

    const monday = mocked.mock.calls[0][0].from;
    expect(monday).toBe(mondayOf(today()));
    expect(document.querySelectorAll("#days .day-card")).toHaveLength(7);
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

describe("weekStats", () => {
  it("counts shifts, open shifts, hours, and people", () => {
    const tiles = weekStats([
      shiftOn("2026-10-05"),
      shiftOn("2026-10-06"),
      shiftOn("2026-10-07", { employee: { id: "u2", display_name: "Ben Okafor" } }),
      shiftOn("2026-10-08", { status: "open", employee: null }),
    ]);

    expect(tiles.map((t) => t.querySelector(".stat__value")?.textContent)).toEqual([
      "4",
      "1",
      "24",
      "2",
    ]);
    // Open shifts need action, so that tile stands out.
    expect(tiles[1].classList.contains("stat--attention")).toBe(true);
  });
});

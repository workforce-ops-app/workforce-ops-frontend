// The home screen's sections under the week (My week): which requests My time off lists,
// which tiles Needs your attention shows for each kind of person, the requests sent, and
// the empty and error states. The API checks every permission again; these tests only
// cover what the screen shows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";
import { loadPage } from "./page-html.js";

// Replace the data sources, so each test decides what the "server" returns.
vi.mock("../../js/api/shifts.js", () => ({ listShifts: vi.fn() }));
vi.mock("../../js/api/time-off.js", () => ({ myRequests: vi.fn(), waitingForMe: vi.fn() }));
vi.mock("../../js/api/announcements.js", () => ({ listAnnouncements: vi.fn() }));
// The permissions and the home department come from the session.
vi.mock("../../js/core/session.js", () => ({ currentSession: vi.fn(), can: vi.fn() }));
// The frame is replaced: the page's own loading is called directly. waitingRequests is
// the frame's shared request for the waiting list.
vi.mock("../../js/components/app-shell.js", () => ({
  startSignedInPage: vi.fn(),
  waitingRequests: vi.fn(),
}));
// Today is fixed, so "this week" and "still to come" do not depend on when the tests run.
vi.mock("../../js/core/week.js", async (original) => ({
  .../** @type {object} */ (await original()),
  today: () => "2026-10-07",
}));

const { listShifts } = await import("../../js/api/shifts.js");
const { myRequests } = await import("../../js/api/time-off.js");
const { can, currentSession } = await import("../../js/core/session.js");
const { waitingRequests } = await import("../../js/components/app-shell.js");
const { attentionTiles, upcomingTimeOff, HOME_TIME_OFF } =
  await import("../../js/components/home-sections.js");
const { showAttention, showMyTimeOff } = await import("../../js/pages/my-shifts.js");

/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);

/**
 * A time-off request as the API sends it.
 * @param {string} id
 * @param {import("../../js/api/time-off.js").TimeOff["status"]} status
 * @param {string} first
 * @param {string} [last]
 * @returns {import("../../js/api/time-off.js").TimeOff}
 */
function request(id, status, first, last = first) {
  return {
    id,
    employee_id: "u1",
    employee_name: "Sam Park",
    first_day: first,
    last_day: last,
    reason: null,
    status,
    not_reviewed: false,
    created_at: "2026-10-01T12:00:00Z",
    decided_at: null,
  };
}

/**
 * A shift, open (nobody assigned) or not.
 * @param {string} id
 * @param {boolean} open
 * @returns {import("../../js/api/shifts.js").Shift}
 */
function shift(id, open) {
  return /** @type {import("../../js/api/shifts.js").Shift} */ ({
    id,
    department: { id: "d1", name: "Front desk" },
    employee: open ? null : { id: "u2", display_name: "Ana Ruiz" },
    starts_at: "2026-10-08T13:00:00Z",
    ends_at: "2026-10-08T21:00:00Z",
    details: null,
    notes: null,
  });
}

/**
 * Give the signed-in person these permissions and home department.
 * @param {string[]} permissions
 * @param {string | null} [departmentId]
 */
function signedInWith(permissions, departmentId = "d1") {
  asMock(can).mockImplementation((code) => permissions.includes(code));
  asMock(currentSession).mockReturnValue({ user: { department_id: departmentId } });
}

/** @param {string} id */
const text = (id) => document.getElementById(id)?.textContent?.trim() ?? "";
/** The tiles' labels and values, e.g. ["Time off to review: 2"]. */
const tiles = () =>
  [...document.querySelectorAll("#attention-tiles .stat")].map(
    (tile) =>
      `${tile.querySelector(".stat__label")?.textContent}: ${tile.querySelector(".stat__value")?.textContent}`,
  );

beforeEach(() => loadPage("my-shifts.html"));
afterEach(() => vi.resetAllMocks());

describe("upcomingTimeOff", () => {
  it("keeps waiting and approved time off still to come, soonest first", () => {
    const shown = upcomingTimeOff(
      [
        request("later", "approved", "2026-11-02"),
        request("waiting", "pending", "2026-10-20"),
        request("up", "escalated", "2026-10-15"),
        // Approved and still going on today: it has not ended yet.
        request("now", "approved", "2026-10-05", "2026-10-07"),
      ],
      "2026-10-07",
    );
    expect(shown.map((r) => r.id)).toEqual(["now", "up", "waiting"]);
  });

  it("leaves out past, denied, and cancelled requests", () => {
    const shown = upcomingTimeOff(
      [
        request("past", "approved", "2026-10-01", "2026-10-06"),
        request("no", "denied", "2026-10-20"),
        request("off", "cancelled", "2026-10-21"),
      ],
      "2026-10-07",
    );
    expect(shown).toEqual([]);
  });

  it("lists at most a few; the rest are on the Time off page", () => {
    const many = Array.from({ length: 6 }, (_, i) => request(`r${i}`, "pending", `2026-10-2${i}`));
    expect(upcomingTimeOff(many, "2026-10-07")).toHaveLength(HOME_TIME_OFF);
  });
});

describe("attentionTiles", () => {
  it("leaves out the parts the person may not see", () => {
    const shown = attentionTiles({ waiting: 0, open: null, openHours: null });
    expect(shown).toHaveLength(1);
    expect(shown[0].classList.contains("stat--attention")).toBe(false);
  });

  it("marks work to do, and caps the waiting count like the menu", () => {
    const shown = attentionTiles({ waiting: 250, open: 1, openHours: 8 });
    expect(shown.map((t) => t.textContent)).toEqual([
      "Time off to review200+",
      "Open shifts this week1",
      "Open hours this week8",
    ]);
    expect(shown.every((t) => t.classList.contains("stat--attention"))).toBe(true);
  });
});

describe("showMyTimeOff", () => {
  it("lists the upcoming requests with their status in words", async () => {
    signedInWith(["time_off.request_self"]);
    asMock(myRequests).mockResolvedValue([
      request("a", "pending", "2026-10-20"),
      request("b", "approved", "2026-11-02", "2026-11-04"),
    ]);

    await showMyTimeOff();

    const items = [...document.querySelectorAll("#home-time-off li")];
    expect(items.map((li) => li.textContent)).toEqual([
      "Tuesday, October 20Waiting for review",
      "Mon, Nov 2 to Wed, Nov 4 (3 days)Approved",
    ]);
    // Waiting requests are marked; approved ones are not.
    expect(items[0].classList.contains("home-time-off--waiting")).toBe(true);
    expect(items[1].classList.contains("home-time-off--waiting")).toBe(false);
    expect(text("time-off-status")).toBe("");
  });

  it("says when nothing is coming up", async () => {
    signedInWith(["time_off.request_self"]);
    asMock(myRequests).mockResolvedValue([request("x", "denied", "2026-10-20")]);

    await showMyTimeOff();

    expect(text("time-off-status")).toBe("No time off coming up.");
  });

  it("asks nothing without the permission", async () => {
    signedInWith([]);

    await showMyTimeOff();

    expect(myRequests).not.toHaveBeenCalled();
  });

  it("explains a failure in plain words, and throws a bug on", async () => {
    signedInWith(["time_off.request_self"]);
    asMock(myRequests).mockRejectedValue(new NetworkError(new TypeError("Failed to fetch")));
    await showMyTimeOff();
    expect(text("time-off-status")).toBe("Problem: the server could not be reached");

    asMock(myRequests).mockRejectedValue(new TypeError("a bug"));
    await expect(showMyTimeOff()).rejects.toThrow("a bug");
    expect(text("time-off-status")).toBe("Problem: your time off could not load");
  });
});

describe("showAttention", () => {
  it("stays hidden, and asks nothing, for an employee", async () => {
    signedInWith(["schedule.view_self", "time_off.request_self"]);

    await showAttention();

    expect(document.getElementById("attention")?.hidden).toBe(true);
    expect(waitingRequests).not.toHaveBeenCalled();
    expect(listShifts).not.toHaveBeenCalled();
  });

  it("shows a reviewer how many requests wait, without shift tiles", async () => {
    signedInWith(["time_off.review"]);
    asMock(waitingRequests).mockResolvedValue([request("a", "pending", "2026-10-20")]);

    await showAttention();

    expect(document.getElementById("attention")?.hidden).toBe(false);
    expect(tiles()).toEqual(["Time off to review: 1"]);
    expect(listShifts).not.toHaveBeenCalled();
  });

  it("shows a planner the open work in their own department this week", async () => {
    signedInWith(["schedule.edit", "time_off.review"], "d1");
    asMock(waitingRequests).mockResolvedValue([]);
    asMock(listShifts).mockResolvedValue([shift("s1", true), shift("s2", false)]);

    await showAttention();

    // Today is Wednesday 2026-10-07, so this week is Monday the 5th to Sunday the 11th.
    expect(listShifts).toHaveBeenCalledWith({
      from: "2026-10-05",
      to: "2026-10-11",
      departmentId: "d1",
    });
    expect(tiles()).toEqual([
      "Time off to review: 0",
      "Open shifts this week: 1",
      "Open hours this week: 8",
    ]);
  });

  it("leaves out the shift tiles for a planner without a home department", async () => {
    signedInWith(["schedule.edit"], null);

    await showAttention();

    expect(document.getElementById("attention")?.hidden).toBe(true);
    expect(listShifts).not.toHaveBeenCalled();
  });

  it("explains a failure in plain words", async () => {
    signedInWith(["time_off.review"]);
    asMock(waitingRequests).mockRejectedValue(new ApiError(500, { title: "Something went wrong" }));

    await showAttention();

    expect(text("attention-status")).toBe("Problem: Something went wrong");
    expect(document.getElementById("attention-tiles")?.hidden).toBe(true);
  });
});

// The week grid and the summary tiles: rows per person, open shifts first, text only
// (threat T5), today marked, and a table a screen reader can navigate.
import { describe, expect, it } from "vitest";
import { statTile } from "../../js/components/stat-tile.js";
import { gridRows, weekGrid } from "../../js/components/week-grid.js";
import { addDays } from "../../js/core/time.js";

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
const MONDAY = "2026-10-05";
const KEYS = Array.from({ length: 7 }, (_, offset) => addDays(MONDAY, offset));

/**
 * A shift in Chicago, 9:00 to 17:00 local time, on the given day.
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

const BEN = { id: "u2", display_name: "Ben Okafor" };

describe("gridRows", () => {
  it("puts open shifts first, then one row per person by name", () => {
    const rows = gridRows([
      shiftOn("2026-10-05", { employee: BEN }),
      shiftOn("2026-10-06"),
      shiftOn("2026-10-07", { status: "open", employee: null }),
      shiftOn("2026-10-08"),
    ]);

    expect(rows.map((r) => r.label)).toEqual(["Open shifts", "Ana Diaz", "Ben Okafor"]);
    expect(rows[1].shifts).toHaveLength(2);
  });
});

describe("weekGrid", () => {
  it("has a column per day and a row per person, with their hours", () => {
    const table = weekGrid(KEYS, [shiftOn("2026-10-05"), shiftOn("2026-10-07")]);

    expect(table.querySelectorAll("thead th[scope=col]")).toHaveLength(9);
    const row = table.querySelector("tbody tr");
    expect(row?.querySelector("th[scope=row]")?.textContent).toBe("Ana Diaz");
    // Two 8-hour shifts.
    expect(row?.lastElementChild?.textContent).toBe("16");
    expect(row?.querySelectorAll(".grid-shift")).toHaveLength(2);
  });

  it("marks open shifts with an icon and words, not colour alone", () => {
    const table = weekGrid(KEYS, [shiftOn("2026-10-06", { status: "open", employee: null })]);

    const name = table.querySelector(".week-grid__row--open th");
    expect(name?.textContent).toBe("Open shifts");
    expect(name?.querySelector(".icon--open")).not.toBeNull();
    expect(table.querySelectorAll(".grid-shift--open")).toHaveLength(1);
  });

  it("highlights today's column and names it for screen readers", () => {
    const table = weekGrid(KEYS, [shiftOn("2026-10-05")], { today: "2026-10-07" });

    const today = table.querySelector(".week-grid__day--today");
    expect(today?.textContent).toContain("Wednesday, October 7 (today)");
    expect(table.querySelectorAll(".week-grid__cell--today")).toHaveLength(1);
  });

  it("keeps names, details, notes, and events as text", () => {
    const table = weekGrid(KEYS, [
      shiftOn("2026-10-05", {
        employee: { id: "u9", display_name: XSS },
        details: XSS,
        notes: XSS,
        event_name: XSS,
      }),
    ]);

    expect(table.querySelector("img, script")).toBeNull();
    expect(table.textContent).toContain(XSS);
  });

  it("says so when the week has no shifts", () => {
    const table = weekGrid(KEYS, []);

    expect(table.querySelector(".week-grid__empty")?.textContent).toBe(
      "No shifts planned this week.",
    );
    expect(table.querySelector(".week-grid__empty")?.getAttribute("colspan")).toBe("9");
  });
});

describe("statTile", () => {
  it("shows a label and a value, amber only when asked", () => {
    const plain = statTile("Shifts", 9);
    const attention = statTile("Open shifts", 2, { attention: true });

    expect(plain.textContent).toBe("Shifts9");
    expect(plain.classList.contains("stat--attention")).toBe(false);
    expect(attention.classList.contains("stat--attention")).toBe(true);
  });
});

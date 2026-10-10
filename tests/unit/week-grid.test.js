// The week grid and the summary tiles: rows per person (open shifts left to their own
// section), text only (threat T5), one day's column highlighted (today unless the mouse
// or focus is on another), and a table a screen reader can navigate.
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

/**
 * The day keys of the highlighted cells, header included.
 * @param {HTMLElement} table
 * @returns {(string | undefined)[]}
 */
const highlighted = (table) =>
  [...table.querySelectorAll(".week-grid__col--active")].map(
    (cell) => /** @type {HTMLElement} */ (cell).dataset.day,
  );

describe("gridRows", () => {
  it("makes one row per person by name, and leaves open shifts out", () => {
    const rows = gridRows([
      shiftOn("2026-10-05", { employee: BEN }),
      shiftOn("2026-10-06"),
      shiftOn("2026-10-07", { status: "open", employee: null }),
      shiftOn("2026-10-08"),
    ]);

    expect(rows.map((r) => r.label)).toEqual(["Ana Diaz", "Ben Okafor"]);
    expect(rows[0].shifts).toHaveLength(2);
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

  it("leaves open shifts out of the grid (they have their own section)", () => {
    const table = weekGrid(KEYS, [
      shiftOn("2026-10-05"),
      shiftOn("2026-10-06", { status: "open", employee: null }),
    ]);

    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(table.querySelectorAll(".grid-shift")).toHaveLength(1);
  });

  it("highlights today's column and names it for screen readers", () => {
    const table = weekGrid(KEYS, [shiftOn("2026-10-05")], { today: "2026-10-07" });

    const today = table.querySelector(".week-grid__day--today");
    expect(today?.textContent).toContain("Wednesday, October 7 (today)");
    // The header and the one row's cell, both on today.
    expect(highlighted(table)).toEqual(["2026-10-07", "2026-10-07"]);
  });

  it("moves the highlight to the day under the mouse, and back to today after", () => {
    const table = weekGrid(KEYS, [shiftOn("2026-10-05")], { today: "2026-10-07" });
    const monday = /** @type {HTMLElement} */ (table.querySelector("button.grid-shift"));

    // Pointer events bubble from the shift up to the table, like in a browser.
    monday.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(highlighted(table)).toEqual(["2026-10-05", "2026-10-05"]);

    // The names column is not a day: the highlight goes back to today.
    table.querySelector("tbody th")?.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(highlighted(table)).toEqual(["2026-10-07", "2026-10-07"]);

    monday.dispatchEvent(new Event("pointerover", { bubbles: true }));
    table.dispatchEvent(new Event("pointerleave"));
    expect(highlighted(table)).toEqual(["2026-10-07", "2026-10-07"]);
  });

  it("follows keyboard focus too", () => {
    const table = weekGrid(KEYS, [shiftOn("2026-10-05")], { today: "2026-10-07" });
    document.body.append(table);

    /** @type {HTMLElement} */ (table.querySelector("button.grid-shift")).focus();
    expect(highlighted(table)).toEqual(["2026-10-05", "2026-10-05"]);

    // Focus leaving the grid brings the highlight back to today.
    /** @type {HTMLElement} */ (document.activeElement).blur();
    expect(highlighted(table)).toEqual(["2026-10-07", "2026-10-07"]);
    table.remove();
  });

  it("highlights nothing in a week without today", () => {
    const table = weekGrid(KEYS, [shiftOn("2026-10-05")], { today: "2026-10-20" });

    expect(highlighted(table)).toEqual([]);
  });

  it("marks a shift with an event or notes, with words for screen readers", () => {
    const table = weekGrid(KEYS, [
      shiftOn("2026-10-05", { notes: "Bring the keys", event_name: "Inventory" }),
      shiftOn("2026-10-06", { id: "plain" }),
    ]);

    const [marked, plain] = table.querySelectorAll("button.grid-shift");
    expect(marked.querySelector(".icon--event")).not.toBeNull();
    expect(marked.querySelector(".icon--note")).not.toBeNull();
    // Only icons on screen; the words are for screen readers, never the note itself.
    expect(marked.textContent).toBe("9:00 AM - 5:00 PMEventNotes");
    expect(plain.querySelector(".shift-extras")).toBeNull();
  });

  it("shows only the time in a cell, and the details as text in the popup", () => {
    const table = weekGrid(KEYS, [
      shiftOn("2026-10-05", {
        employee: { id: "u9", display_name: XSS },
        details: XSS,
        notes: XSS,
        event_name: XSS,
      }),
    ]);
    document.body.append(table);

    // The cell: the time and the markers' words, as a button; the row's name is text,
    // never HTML.
    const button = /** @type {HTMLButtonElement} */ (table.querySelector("button.grid-shift"));
    expect(button.textContent).toBe("9:00 AM - 5:00 PMEventNotes");
    expect(table.querySelector("img, script")).toBeNull();
    expect(table.querySelector("tbody th")?.textContent).toBe(XSS);

    // The popup: every detail, as text.
    button.click();
    const popup = document.querySelector("dialog.shift-dialog");
    expect(popup?.querySelector("img, script")).toBeNull();
    expect(popup?.textContent).toContain(XSS);
    popup?.remove();
    table.remove();
  });

  it("says so when nobody is scheduled this week", () => {
    const table = weekGrid(KEYS, [shiftOn("2026-10-06", { status: "open", employee: null })]);

    expect(table.querySelector(".week-grid__empty")?.textContent).toBe(
      "Nobody is scheduled this week.",
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

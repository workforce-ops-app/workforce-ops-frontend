// Shift rows and day cards: text only (threat T5), open shifts and today marked, and
// markers for shifts with an event or notes.
import { describe, expect, it } from "vitest";
import { dayCard, groupByDay } from "../../js/components/day-list.js";
import { icon, noShiftRow, shiftExtras, shiftRow } from "../../js/components/shift-card.js";

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

/**
 * A shift with sensible defaults, in Chicago.
 * @param {Partial<import("../../js/api/shifts.js").Shift>} overrides
 * @returns {import("../../js/api/shifts.js").Shift}
 */
function makeShift(overrides = {}) {
  return {
    id: "s1",
    department: { id: "d1", name: "Kitchen" },
    employee: { id: "u1", display_name: "Ana Diaz" },
    starts_at: "2026-10-05T14:00:00Z",
    ends_at: "2026-10-05T22:00:00Z",
    timezone: "America/Chicago",
    status: "scheduled",
    details: "Prep line",
    notes: null,
    event_name: null,
    event_description: null,
    ...overrides,
  };
}

describe("shiftRow", () => {
  it("shows the time and markers, as a button that opens the details (My week)", () => {
    const row = shiftRow(makeShift({ notes: "Keys", event_name: "Inventory night" }));

    expect(row.tagName).toBe("BUTTON");
    expect(row.getAttribute("type")).toBe("button");
    expect(row.getAttribute("aria-haspopup")).toBe("dialog");
    expect(row.querySelector(".shift__time")?.textContent).toBe("9:00 AM - 5:00 PM");
    // Markers say there is an event and notes; the details themselves wait for the popup.
    expect(row.textContent).toBe("9:00 AM - 5:00 PMEventNotes");
    expect(row.querySelector(".icon--event")).not.toBeNull();
    expect(row.querySelector(".icon--note")).not.toBeNull();
    expect(row.querySelector(".icon--clock")).not.toBeNull();
    expect(row.querySelector(".icon--chevron-right")).not.toBeNull();
  });

  it("adds who works it, for the department week", () => {
    const row = shiftRow(makeShift(), { showEmployee: true });

    expect(row.querySelector(".shift__who")?.textContent).toBe("Ana Diaz");
    expect(row.textContent).not.toContain("Prep line");
  });

  it("keeps a name with HTML in it as plain text", () => {
    const row = shiftRow(makeShift({ employee: { id: "u1", display_name: XSS } }), {
      showEmployee: true,
    });

    expect(row.querySelector("script")).toBeNull();
    expect(row.querySelector("img")).toBeNull();
    expect(row.textContent).toContain("<script>alert(2)</script>");
  });

  it("marks an open shift, with its own icon and label", () => {
    const row = shiftRow(makeShift({ status: "open", employee: null }), { showEmployee: true });

    expect(row.classList.contains("shift--open")).toBe(true);
    expect(row.querySelector(".icon--open")).not.toBeNull();
    expect(row.querySelector(".shift__who")?.textContent).toBe("Open shift");
  });
});

describe("shiftExtras", () => {
  it("shows a word and an icon for each, or nothing for a plain shift", () => {
    expect(shiftExtras(makeShift())).toBeNull();
    expect(shiftExtras(makeShift({ notes: "Keys" }))?.textContent).toBe("Notes");
    expect(shiftExtras(makeShift({ event_name: "Inventory" }))?.textContent).toBe("Event");
  });

  it("keeps the words for screen readers when only icons fit", () => {
    const extras = shiftExtras(makeShift({ notes: "Keys" }), { compact: true });

    expect(extras?.querySelector(".visually-hidden")?.textContent).toBe("Notes");
    expect(extras?.querySelector(".icon--note")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("noShiftRow and icon", () => {
  it("shows a day off", () => {
    const row = noShiftRow();

    expect(row.textContent).toBe("No shift");
    expect(row.querySelector(".icon--lounge")).not.toBeNull();
    // Nothing to open on a day off.
    expect(row.tagName).toBe("DIV");
  });

  it("hides icons from screen readers (the text carries the meaning)", () => {
    expect(icon("clock").getAttribute("aria-hidden")).toBe("true");
  });
});

describe("groupByDay and dayCard", () => {
  it("puts a late shift on the day it starts in its workplace zone", () => {
    // 22:30 in Chicago on October 5 is already October 6 in UTC.
    const late = makeShift({ starts_at: "2026-10-06T03:30:00Z", ends_at: "2026-10-06T10:00:00Z" });

    expect([...groupByDay([late]).keys()]).toEqual(["2026-10-05"]);
  });

  it("shows the weekday and date, labelled with the full date for screen readers", () => {
    const card = dayCard("2026-10-05", [makeShift()]);

    expect(card.querySelector(".day-card__weekday")?.textContent).toBe("MON");
    expect(card.querySelector(".day-card__number")?.textContent).toBe("5");
    expect(card.getAttribute("aria-label")).toBe("Monday, October 5");
    expect(card.querySelectorAll(".shift")).toHaveLength(1);
  });

  it("shows No shift on an empty day, and marks today", () => {
    const card = dayCard("2026-10-05", [], { today: "2026-10-05" });

    expect(card.textContent).toContain("No shift");
    expect(card.classList.contains("day-card--today")).toBe(true);
    expect(card.getAttribute("aria-label")).toBe("Monday, October 5 (today)");
  });
});

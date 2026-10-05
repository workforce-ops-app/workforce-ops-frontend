// The shift card and day sections: text only (threat T5), open shifts highlighted.
import { describe, expect, it } from "vitest";
import { daySection, groupByDay } from "../../js/components/day-list.js";
import { shiftCard } from "../../js/components/shift-card.js";

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

describe("shiftCard", () => {
  it("shows the time in the workplace zone and who works it", () => {
    const card = shiftCard(makeShift());

    expect(card.textContent).toContain("9:00 AM - 5:00 PM");
    expect(card.textContent).toContain("Ana Diaz");
    expect(card.classList.contains("shift-card--open")).toBe(false);
  });

  it("keeps HTML in every user-written field as plain text", () => {
    // A note, details, event, and even a person's name could hold an attack.
    const card = shiftCard(
      makeShift({
        notes: XSS,
        details: XSS,
        event_name: XSS,
        event_description: XSS,
        employee: { id: "u1", display_name: XSS },
      }),
    );

    expect(card.querySelector("script")).toBeNull();
    expect(card.querySelector("img")).toBeNull();
    expect(card.textContent).toContain("<script>alert(2)</script>");
  });

  it("highlights an open shift", () => {
    const card = shiftCard(makeShift({ status: "open", employee: null }));

    expect(card.classList.contains("shift-card--open")).toBe(true);
    expect(card.textContent).toContain("Open shift");
  });

  it("shows the event, and the department only when asked", () => {
    const shift = makeShift({ event_name: "Inventory night", event_description: "Count it all" });

    expect(shiftCard(shift).textContent).toContain("Event: Inventory night");
    expect(shiftCard(shift).textContent).toContain("Count it all");
    expect(shiftCard(shift).textContent).not.toContain("Kitchen");
    expect(shiftCard(shift, { showDepartment: true }).textContent).toContain("Prep line · Kitchen");
  });
});

describe("shiftCard with fields left empty", () => {
  it("leaves out what is not there", () => {
    // No details, no notes, and an event without a description.
    const card = shiftCard(makeShift({ details: null, event_name: "Inventory night" }));

    expect(card.querySelector(".shift-card__details")).toBeNull();
    expect(card.querySelectorAll(".shift-card__note")).toHaveLength(0);
    expect(card.textContent).toContain("Event: Inventory night");
  });
});

describe("groupByDay and daySection", () => {
  it("puts a late shift on the day it starts in its workplace zone", () => {
    // 22:30 in Chicago on October 5 is already October 6 in UTC.
    const late = makeShift({
      id: "late",
      starts_at: "2026-10-06T03:30:00Z",
      ends_at: "2026-10-06T10:00:00Z",
    });

    expect([...groupByDay([late]).keys()]).toEqual(["2026-10-05"]);
  });

  it("names the day and says when it is empty", () => {
    const empty = daySection("2026-10-05", []);

    expect(empty.querySelector("h2")?.textContent).toBe("Monday, October 5");
    expect(empty.textContent).toContain("No shifts");
    expect(daySection("2026-10-05", [makeShift()]).textContent).not.toContain("No shifts");
  });
});

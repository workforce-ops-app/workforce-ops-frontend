// The sections under the department week: open shifts as buttons that open their details,
// the people without a shift, and text only for every user-written value (threat T5).
import { describe, expect, it } from "vitest";
import {
  openShiftsSection,
  unscheduledPeople,
  unscheduledSection,
} from "../../js/components/week-sections.js";

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

const ANA = { id: "u1", display_name: "Ana Diaz" };
const BEN = { id: "u2", display_name: "Ben Okafor" };
const CARA = { id: "u3", display_name: "Cara Lund" };

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
    employee: ANA,
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

describe("openShiftsSection", () => {
  it("lists only the open shifts, with day, time, and role, each opening its details", () => {
    const section = openShiftsSection([
      shiftOn("2026-10-05"),
      shiftOn("2026-10-08", { status: "open", employee: null, details: "Grill" }),
    ]);

    const buttons = section.querySelectorAll("button.open-shift");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("Thursday, October 89:00 AM - 5:00 PMGrill");
    expect(buttons[0].getAttribute("aria-haspopup")).toBe("dialog");
    // An icon as well as the amber colour, and a count in the heading.
    expect(buttons[0].querySelector(".icon--open")).not.toBeNull();
    expect(section.querySelector("h2")?.textContent).toBe("Open shifts 1");
  });

  it("says so when there are none", () => {
    const section = openShiftsSection([shiftOn("2026-10-05")]);

    expect(section.querySelector(".week-section__empty")?.textContent).toBe(
      "No open shifts this week.",
    );
  });

  it("keeps a role with HTML in it as plain text", () => {
    const section = openShiftsSection([
      shiftOn("2026-10-08", { status: "open", employee: null, details: XSS }),
    ]);

    expect(section.querySelector("img, script")).toBeNull();
    expect(section.querySelector(".open-shift__role")?.textContent).toBe(XSS);
  });
});

describe("unscheduledPeople and unscheduledSection", () => {
  it("lists the people without a shift that week, by name", () => {
    const shifts = [
      shiftOn("2026-10-05"),
      shiftOn("2026-10-08", { status: "open", employee: null }),
    ];

    expect(unscheduledPeople([CARA, ANA, BEN], shifts)).toEqual([BEN, CARA]);
  });

  it("shows a name tag per person, as text, with the count", () => {
    const section = unscheduledSection(
      [ANA, { id: "u9", display_name: XSS }],
      [shiftOn("2026-10-05")],
    );

    expect(section.querySelectorAll(".people-tag")).toHaveLength(1);
    expect(section.querySelector(".people-tag")?.textContent).toBe(XSS);
    expect(section.querySelector("img, script")).toBeNull();
    expect(section.querySelector("h2")?.textContent).toBe("Unscheduled employees 1");
  });

  it("says so when everyone has a shift", () => {
    const section = unscheduledSection([ANA], [shiftOn("2026-10-05")]);

    expect(section.querySelector(".week-section__empty")?.textContent).toBe(
      "Everyone has a shift this week.",
    );
  });
});

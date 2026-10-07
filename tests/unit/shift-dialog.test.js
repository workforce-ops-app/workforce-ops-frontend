// The shift details popup: what it shows, text only (threat T5), and closing it.
import { afterEach, describe, expect, it } from "vitest";
import { shiftRow } from "../../js/components/shift-card.js";
import { closeShiftDialog, openShiftDialog } from "../../js/components/shift-dialog.js";

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
    starts_at: "2026-10-07T12:00:00Z",
    ends_at: "2026-10-07T20:00:00Z",
    timezone: "America/Chicago",
    status: "scheduled",
    details: "Prep line",
    notes: "Deliveries arrive at 8.",
    event_name: "Inventory night",
    event_description: "Count the walk-in.",
    ...overrides,
  };
}

/** The popup on the page, if there is one. */
const popup = () => document.querySelector("dialog.shift-dialog");

/**
 * The popup's facts as label and value pairs.
 * @returns {string[][]}
 */
function facts() {
  const labels = [...(popup()?.querySelectorAll("dt") ?? [])];
  return labels.map((dt) => [dt.textContent ?? "", dt.nextElementSibling?.textContent ?? ""]);
}

afterEach(() => {
  closeShiftDialog();
  document.body.replaceChildren();
});

describe("openShiftDialog", () => {
  it("shows the day, the time, and every detail", () => {
    openShiftDialog(makeShift());

    expect(popup()?.hasAttribute("open")).toBe(true);
    expect(popup()?.querySelector("h2")?.textContent).toBe("Wednesday, October 7");
    expect(popup()?.querySelector(".shift-dialog__time")?.textContent).toBe("7:00 AM - 3:00 PM");
    expect(facts()).toEqual([
      ["Who", "Ana Diaz"],
      ["Role", "Prep line"],
      ["Department", "Kitchen"],
      ["Event", "Inventory night: Count the walk-in."],
      ["Notes", "Deliveries arrive at 8."],
    ]);
  });

  it("names the popup by its heading, for screen readers", () => {
    openShiftDialog(makeShift());

    const id = popup()?.getAttribute("aria-labelledby");
    expect(id && document.getElementById(id)?.textContent).toBe("Wednesday, October 7");
  });

  it("says an open shift is open in words, and leaves out empty details", () => {
    openShiftDialog(
      makeShift({
        status: "open",
        employee: null,
        notes: null,
        event_name: null,
        event_description: null,
      }),
    );

    expect(popup()?.querySelector(".shift-dialog__open")?.textContent).toBe(
      "Open shift: nobody assigned yet",
    );
    expect(facts()).toEqual([
      ["Role", "Prep line"],
      ["Department", "Kitchen"],
    ]);
  });

  it("keeps HTML in every user-written field as plain text", () => {
    openShiftDialog(
      makeShift({
        employee: { id: "u1", display_name: XSS },
        details: XSS,
        notes: XSS,
        event_name: XSS,
        event_description: XSS,
      }),
    );

    expect(popup()?.querySelector("script, img")).toBeNull();
    expect(popup()?.textContent).toContain("<script>alert(2)</script>");
  });

  it("reuses one popup for every shift", () => {
    openShiftDialog(makeShift());
    openShiftDialog(makeShift({ details: "Grill" }));

    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(facts()[1]).toEqual(["Role", "Grill"]);
  });
});

describe("opening from a shift and closing", () => {
  it("opens from a click on the shift and gives focus back on Close", () => {
    const row = shiftRow(makeShift());
    document.body.append(row);

    row.click();
    expect(popup()?.hasAttribute("open")).toBe(true);
    // Focus starts on the Close button.
    const close = /** @type {HTMLButtonElement} */ (popup()?.querySelector("button"));
    expect(document.activeElement).toBe(close);

    close.click();
    expect(popup()?.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(row);
  });
});

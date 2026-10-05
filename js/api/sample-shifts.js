// Sample shifts, until the shifts API exists (backend SC1). Delete this file when the
// screens switch to the real API (js/api/shifts.js, USE_SAMPLE_DATA).
//
// The shifts are built around the current week, so the screens always have something to
// show. They are shaped exactly like the API's answer, use the demo company's names, and
// cover what the screens must handle: assigned and open shifts, an event, notes, two
// departments, and a cancelled shift that must not appear.

import { addDays, dayKey, mondayOf, zonedTimeToUtc } from "../core/time.js";

/** @typedef {import("./shifts.js").Shift} Shift */
/** @typedef {import("./shifts.js").ShiftQuery} ShiftQuery */

const TIMEZONE = "America/Chicago";
const KITCHEN = { id: "sample-dept-kitchen", name: "Kitchen" };
const FRONT = { id: "sample-dept-front", name: "Front of House" };
/** The signed-in person in sample mode ("my shifts"). */
export const SAMPLE_ME = { id: "sample-user-ana", display_name: "Ana Diaz" };
const BEN = { id: "sample-user-ben", display_name: "Ben Okafor" };
const CARA = { id: "sample-user-cara", display_name: "Cara Lund" };

/**
 * One sample shift.
 * @param {number} n a number that makes the ID unique
 * @param {string} day "YYYY-MM-DD"
 * @param {string} start "HH:MM" in the workplace zone
 * @param {string} end "HH:MM" in the workplace zone
 * @param {Partial<Shift>} rest the other fields
 * @returns {Shift}
 */
function shift(n, day, start, end, rest) {
  return {
    id: `sample-shift-${n}`,
    department: KITCHEN,
    employee: null,
    starts_at: zonedTimeToUtc(day, start, TIMEZONE),
    ends_at: zonedTimeToUtc(day, end, TIMEZONE),
    timezone: TIMEZONE,
    status: "scheduled",
    details: null,
    notes: null,
    event_name: null,
    event_description: null,
    ...rest,
  };
}

/**
 * The sample shifts for this week and next.
 * @returns {Shift[]}
 */
function allSampleShifts() {
  // Days counted from this week's Monday in the workplace zone.
  const monday = mondayOf(dayKey(new Date(), TIMEZONE));
  const day = (/** @type {number} */ offset) => addDays(monday, offset);

  return [
    shift(1, day(0), "07:00", "15:00", { employee: SAMPLE_ME, details: "Prep line" }),
    shift(2, day(0), "15:00", "23:00", { employee: BEN, details: "Grill" }),
    shift(3, day(1), "07:00", "15:00", { employee: CARA, details: "Prep line" }),
    shift(4, day(2), "07:00", "15:00", {
      employee: SAMPLE_ME,
      details: "Prep line",
      notes: "Deliveries arrive at 8; check the produce order against the invoice.",
    }),
    // An open shift: nobody assigned yet, so the week view highlights it.
    shift(5, day(3), "15:00", "23:00", { status: "open", details: "Grill" }),
    shift(6, day(4), "16:00", "23:30", {
      employee: BEN,
      details: "Grill",
      event_name: "Inventory night",
      event_description: "Count the walk-in and dry storage after close.",
    }),
    shift(7, day(4), "07:00", "15:00", { employee: SAMPLE_ME, details: "Prep line" }),
    // A cancelled shift: kept in the database, never shown.
    shift(8, day(5), "09:00", "17:00", { employee: CARA, status: "cancelled" }),
    shift(9, day(5), "10:00", "18:00", { department: FRONT, employee: CARA, details: "Host" }),
    shift(10, day(7), "07:00", "15:00", { employee: SAMPLE_ME, details: "Prep line" }),
    shift(11, day(9), "15:00", "23:00", { status: "open", details: "Grill" }),
  ];
}

/**
 * The sample shifts matching a query, the way the API filters them.
 * @param {ShiftQuery} query
 * @returns {Promise<Shift[]>}
 */
export async function sampleShifts(query) {
  return (
    allSampleShifts()
      // Cancelled shifts disappear from normal views (schedules feature page).
      .filter((s) => s.status !== "cancelled")
      // Only the days asked for, counted in each shift's workplace zone.
      .filter((s) => {
        const key = dayKey(s.starts_at, s.timezone);
        return key >= query.from && key <= query.to;
      })
      // One department, if asked for.
      .filter((s) => !query.departmentId || s.department.id === query.departmentId)
      // Only the signed-in person's shifts, if asked for.
      .filter((s) => !query.mine || s.employee?.id === SAMPLE_ME.id)
      // In time order, as the API returns them.
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  );
}

/** The sample departments, for the week view's default. */
export const SAMPLE_DEPARTMENTS = [KITCHEN, FRONT];

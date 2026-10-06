// Sample shifts, until the shifts API exists (backend SC1). js/api/shifts.js loads this
// file only while USE_SAMPLE_DATA is true; see there for how to switch to the real API.
//
// The shifts are built around the current week, so the screens always have something to
// show. They are shaped exactly like the API's answer, use the demo company's names, and
// cover what the screens must handle: assigned and open shifts, an event, notes, two
// departments, and a cancelled shift that must not appear.

import { addDays, dayKey, mondayOf, zonedTimeToUtc } from "../core/time.js";

/** @typedef {import("./shifts.js").Shift} Shift */
/** @typedef {import("./shifts.js").ShiftQuery} ShiftQuery */

const TIMEZONE = "America/Chicago";

/**
 * A fixed sample ID, shaped like the API's IDs: a UUIDv7 written with hyphens (backend
 * data model). The 7 marks the version and the 8 the variant, as in a real UUIDv7; the
 * last group tells the samples apart (d.. departments, a.. people, plain numbers shifts).
 * Fixed rather than random, so tests and bookmarks keep working.
 * @param {string} suffix up to 12 hexadecimal digits
 * @returns {string}
 */
const sampleId = (suffix) => `01926f3a-0000-7000-8000-${suffix.padStart(12, "0")}`;

const KITCHEN = { id: sampleId("d01"), name: "Kitchen" };
const FRONT = { id: sampleId("d02"), name: "Front of House" };
/** The signed-in person in sample mode ("my shifts"). */
export const SAMPLE_ME = { id: sampleId("a01"), display_name: "Ana Diaz" };
/** The signed-in person's own department, which the department week shows by default. */
export const SAMPLE_MY_DEPARTMENT_ID = KITCHEN.id;
const BEN = { id: sampleId("a02"), display_name: "Ben Okafor" };
const CARA = { id: sampleId("a03"), display_name: "Cara Lund" };
const DEV = { id: sampleId("a04"), display_name: "Dev Patel" };
const ELI = { id: sampleId("a05"), display_name: "Eli Moreno" };

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
    id: sampleId(String(n)),
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
    // More of the kitchen's week, so the department grid looks like a real week.
    shift(12, day(1), "15:00", "23:00", { employee: BEN, details: "Grill" }),
    shift(13, day(1), "10:00", "18:00", { employee: ELI, details: "Dish" }),
    shift(14, day(2), "15:00", "23:00", { employee: DEV, details: "Grill" }),
    shift(15, day(3), "07:00", "15:00", { employee: CARA, details: "Prep line" }),
    shift(16, day(3), "10:00", "18:00", { employee: ELI, details: "Dish" }),
    shift(17, day(5), "07:00", "15:00", { employee: SAMPLE_ME, details: "Prep line" }),
    shift(18, day(5), "15:00", "23:00", { employee: DEV, details: "Grill" }),
    shift(19, day(6), "10:00", "18:00", { employee: ELI, details: "Dish" }),
    shift(20, day(6), "16:00", "22:00", { status: "open", details: "Dish" }),
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

/** The sample departments, for the department week's heading. */
export const SAMPLE_DEPARTMENTS = [KITCHEN, FRONT];

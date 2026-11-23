// The numbers of one week of shifts, as summary tiles: shifts, open shifts, open hours, and
// people working. Shared by the department week (its tiles at the top) and the home
// screen (the open work in the person's own department, for people who plan the week).

import { hoursBetween, roundHours } from "../core/time.js";
import { statTile } from "./stat-tile.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */

/**
 * The open work of a week: the shifts nobody is assigned to yet, and their hours.
 *
 * Open hours are what a manager still has to cover (#51). hoursBetween measures the real
 * time between the UTC moments, so an overnight shift counts its full length, and so does
 * a night when the clocks change.
 * @param {Shift[]} shifts the week's shifts (no cancelled ones)
 * @returns {{ open: Shift[], openHours: number }}
 */
export function openWork(shifts) {
  const open = shifts.filter((s) => !s.employee);
  const openHours = open.reduce((sum, s) => sum + hoursBetween(s.starts_at, s.ends_at), 0);
  return { open, openHours };
}

/**
 * The week's numbers for the department week's tiles.
 *
 * A total of all scheduled hours was shown here before, but without a labor budget to
 * compare it with it did not help decide anything, and it left the open shifts out.
 * (The calendar draws each shift's length; it does not add up each person's hours.)
 * @param {Shift[]} shifts the week's shifts (no cancelled ones)
 * @returns {HTMLElement[]}
 */
export function weekStats(shifts) {
  const { open, openHours } = openWork(shifts);
  // People working: everyone with at least one shift, each counted once.
  const people = new Set(shifts.filter((s) => s.employee).map((s) => s.employee?.id)).size;
  return [
    statTile("Shifts", shifts.length),
    statTile("Open shifts", open.length, { attention: open.length > 0 }),
    statTile("Open hours", roundHours(openHours), { attention: openHours > 0 }),
    statTile("People working", people),
  ];
}

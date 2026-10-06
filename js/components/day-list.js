// Shifts grouped by calendar day, shown as day cards: one white card per day, with the
// weekday and date on the left and that day's shifts (or "No shift") on the right.
// Used by My week and the department week.

import { el } from "../core/dom.js";
import { dayKey, formatDayHeading, formatDayNumber, formatWeekdayShort } from "../core/time.js";
import { noShiftRow, shiftRow } from "./shift-card.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */

/**
 * Sort shifts into their calendar days.
 * @param {Shift[]} shifts
 * @returns {Map<string, Shift[]>} day key ("YYYY-MM-DD") to that day's shifts
 */
export function groupByDay(shifts) {
  /** @type {Map<string, Shift[]>} */
  const days = new Map();
  for (const shift of shifts) {
    // The day a shift belongs to is the day it starts, in its own workplace zone (a shift
    // from 22:00 to 06:00 belongs to the day it starts).
    const key = dayKey(shift.starts_at, shift.timezone);
    const list = days.get(key) ?? [];
    list.push(shift);
    days.set(key, list);
  }
  return days;
}

/**
 * One day's card.
 * @param {string} key "YYYY-MM-DD"
 * @param {Shift[]} shifts the day's shifts, in time order
 * @param {{ showEmployee?: boolean, today?: string }} [options] showEmployee is passed on
 *   to each shift row; today (a day key) marks today's card
 * @returns {HTMLElement}
 */
export function dayCard(key, shifts, options = {}) {
  // The date column: a small "MON" over a large "28". Screen readers get the full date
  // ("Monday, September 28") from the card's label instead.
  const date = el("div", { className: "day-card__date", attrs: { "aria-hidden": "true" } }, [
    el("span", { className: "day-card__weekday", text: formatWeekdayShort(key) }),
    el("span", { className: "day-card__number", text: formatDayNumber(key) }),
  ]);

  // The day's shifts, or a single "No shift" row.
  const rows = shifts.length
    ? shifts.map((shift) => shiftRow(shift, { showEmployee: options.showEmployee }))
    : [noShiftRow()];

  const isToday = options.today === key;
  return el(
    "article",
    {
      className: isToday ? "day-card day-card--today" : "day-card",
      attrs: { "aria-label": `${formatDayHeading(key)}${isToday ? " (today)" : ""}` },
    },
    [date, el("div", { className: "day-card__shifts" }, rows)],
  );
}

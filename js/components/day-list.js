// Shifts grouped by calendar day: one section per day, with a heading and the day's cards.
// Used by My shifts and the department week.

import { el } from "../core/dom.js";
import { dayKey, formatDayHeading } from "../core/time.js";
import { shiftCard } from "./shift-card.js";

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
 * One day's section: a heading such as "Monday, October 5" and the shift cards, or a
 * short "No shifts" line when the day is empty.
 * @param {string} key "YYYY-MM-DD"
 * @param {Shift[]} shifts the day's shifts, in time order
 * @param {{ showDepartment?: boolean }} [options] passed on to each card
 * @returns {HTMLElement}
 */
export function daySection(key, shifts, options = {}) {
  const section = el(
    "section",
    { className: "day", attrs: { "aria-label": formatDayHeading(key) } },
    [el("h2", { className: "day__heading", text: formatDayHeading(key) })],
  );
  if (shifts.length === 0) {
    section.append(el("p", { className: "day__empty muted", text: "No shifts" }));
  }
  for (const shift of shifts) section.append(shiftCard(shift, options));
  return section;
}

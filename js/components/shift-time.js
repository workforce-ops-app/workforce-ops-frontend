// A shift's time as every screen shows it: "10:00 PM - 6:00 AM", in its workplace zone,
// plus a "+1 day" marker when it ends on the next day (an overnight shift). A shift is
// listed on the day it starts, so without the marker "6:00 AM" could be read as that same
// morning. Used by the day cards, the week grid, the open shifts, and the details popup.

import { el } from "../core/dom.js";
import { daysLater, formatTimeRange } from "../core/time.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */

/**
 * The "+1 day" marker for a shift that ends on a later day than it starts (an overnight
 * shift, e.g. 10:00 PM - 6:00 AM). The shift is shown on the day it starts, so without the
 * marker "6:00 AM" could be read as that same morning. Screen readers hear "ends the next
 * day" instead of the symbol.
 * @param {Shift} shift
 * @returns {HTMLElement | null} null for a shift that ends the same day
 */
export function nextDayMarker(shift) {
  const days = daysLater(shift.starts_at, shift.ends_at, shift.timezone);
  if (days < 1) return null;
  return el("span", { className: "next-day" }, [
    el("span", { text: `+${days} day${days === 1 ? "" : "s"}`, attrs: { "aria-hidden": "true" } }),
    el("span", {
      className: "visually-hidden",
      text: days === 1 ? " (ends the next day)" : ` (ends ${days} days later)`,
    }),
  ]);
}

/**
 * The time of a shift with its "+1 day" marker when it ends the next day: one element, so
 * every screen shows overnight shifts the same way.
 * @param {Shift} shift
 * @param {string} className the time's class on that screen
 * @returns {HTMLElement}
 */
export function shiftTime(shift, className) {
  const time = el("span", {
    className,
    text: formatTimeRange(shift.starts_at, shift.ends_at, shift.timezone),
  });
  const marker = nextDayMarker(shift);
  if (marker) time.append(" ", marker);
  return time;
}

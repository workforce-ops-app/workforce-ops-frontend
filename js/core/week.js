// The week a page shows, taken from its address (?week=YYYY-MM-DD), and the addresses of
// the weeks before and after. Shared by My week and the department week.

import { addDays, dayKey, mondayOf } from "./time.js";

/**
 * Today's day key in the viewer's own calendar.
 * @returns {string}
 */
export function today() {
  return dayKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * Whether a value is a real calendar day written as "YYYY-MM-DD". The pattern alone lets
 * through days that do not exist (2026-99-99, 2026-02-30), so the day is also read as a
 * date and written back: only a real day comes back unchanged.
 * @param {string | null} value
 * @returns {value is string}
 */
export function isDayKey(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // An impossible date gives "Invalid Date", whose getTime() is NaN; check that before
  // toISOString(), which would throw on it.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The Monday of the week the address asks for. Any day of a week selects that week; a
 * missing, malformed, or impossible value means the current week.
 * @param {URLSearchParams} params the address's query parameters
 * @param {string} todayKey today's day key
 * @returns {string} "YYYY-MM-DD"
 */
export function requestedMonday(params, todayKey) {
  const requested = params.get("week");
  return mondayOf(isDayKey(requested) ? requested : todayKey);
}

/**
 * The address of the same page for another week, keeping other settings (e.g. the
 * department). URLSearchParams escapes every value, so a link can only ever carry them.
 * @param {string} monday "YYYY-MM-DD"
 * @param {number} weeks how many weeks later (negative: earlier)
 * @param {URLSearchParams} params the current address's parameters
 * @returns {string} e.g. "?week=2026-10-05&department=d1"
 */
export function weekLink(monday, weeks, params) {
  const next = new URLSearchParams(params);
  next.set("week", addDays(monday, weeks * 7));
  return `?${next}`;
}

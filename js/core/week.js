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
 * The Monday of the week the address asks for. Any day of a week selects that week; a
 * missing or malformed value (anything but YYYY-MM-DD) means the current week.
 * @param {URLSearchParams} params the address's query parameters
 * @param {string} todayKey today's day key
 * @returns {string} "YYYY-MM-DD"
 */
export function requestedMonday(params, todayKey) {
  const requested = params.get("week");
  return mondayOf(requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayKey);
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

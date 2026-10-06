// Dates and times in the workplace's time zone (decision 0021).
//
// The API sends every moment in UTC (for example "2026-10-05T14:00:00Z") together with the
// shift's time zone (for example "America/Chicago"). Pages show times in that workplace
// zone, not in the viewer's own zone, so a manager travelling elsewhere still sees the
// times the staff work. The browser's built-in Intl.DateTimeFormat does the converting.
//
// Calendar days are handled as "YYYY-MM-DD" strings ("day keys"), the same format the API
// uses for dates, which avoids time-zone surprises when counting days.

/**
 * The calendar day of a moment, in a time zone, as "YYYY-MM-DD".
 * @param {string | Date} moment an ISO 8601 moment or a Date
 * @param {string} timeZone an IANA zone name, e.g. "America/Chicago"
 * @returns {string}
 */
export function dayKey(moment, timeZone) {
  // The "en-CA" locale writes dates as YYYY-MM-DD, exactly the format we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(moment));
}

/**
 * The time of a moment in a time zone, e.g. "9:00 AM".
 * @param {string} moment an ISO 8601 moment
 * @param {string} timeZone
 * @returns {string}
 */
export function formatTime(moment, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(
    new Date(moment),
  );
}

/**
 * A shift's start and end, e.g. "9:00 AM - 5:00 PM", in its workplace zone.
 * @param {string} startsAt
 * @param {string} endsAt
 * @param {string} timeZone
 * @returns {string}
 */
export function formatTimeRange(startsAt, endsAt, timeZone) {
  return `${formatTime(startsAt, timeZone)} - ${formatTime(endsAt, timeZone)}`;
}

/**
 * A day heading for a day key, e.g. "Monday, October 5".
 * @param {string} key "YYYY-MM-DD"
 * @returns {string}
 */
export function formatDayHeading(key) {
  // Noon UTC on that day, formatted in UTC: the same calendar day everywhere, so no time
  // zone can push the heading to the day before or after.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${key}T12:00:00Z`));
}

/**
 * Format a day key in UTC (noon), so no time zone can move it to another day.
 * @param {string} key "YYYY-MM-DD"
 * @param {Intl.DateTimeFormatOptions} options
 * @returns {string}
 */
function formatDay(key, options) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(
    new Date(`${key}T12:00:00Z`),
  );
}

/**
 * The short weekday of a day key, in capitals, e.g. "MON" (the day cards' small label).
 * @param {string} key "YYYY-MM-DD"
 * @returns {string}
 */
export function formatWeekdayShort(key) {
  return formatDay(key, { weekday: "short" }).toUpperCase();
}

/**
 * The day of the month of a day key, e.g. "28" (the day cards' large number).
 * @param {string} key "YYYY-MM-DD"
 * @returns {string}
 */
export function formatDayNumber(key) {
  return formatDay(key, { day: "numeric" });
}

/**
 * A week's dates for the week navigation, e.g. "Sep 28 to Oct 4".
 * @param {string} monday "YYYY-MM-DD"
 * @returns {string}
 */
export function formatWeekRange(monday) {
  const options = /** @type {const} */ ({ month: "short", day: "numeric" });
  return `${formatDay(monday, options)} to ${formatDay(addDays(monday, 6), options)}`;
}

/**
 * The hours between two moments, e.g. 8 for a 9:00 to 17:00 shift (7.5 for half hours).
 * @param {string} startsAt
 * @param {string} endsAt
 * @returns {number}
 */
export function hoursBetween(startsAt, endsAt) {
  return (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3600000;
}

/**
 * The day key a number of days after (or before, if negative) another day key.
 * @param {string} key "YYYY-MM-DD"
 * @param {number} days
 * @returns {string}
 */
export function addDays(key, days) {
  // Count in UTC, where every day has exactly 24 hours (no daylight-saving jumps).
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The Monday of the week a day key falls in (weeks run Monday to Sunday).
 * @param {string} key "YYYY-MM-DD"
 * @returns {string}
 */
export function mondayOf(key) {
  // getUTCDay(): 0 is Sunday, 1 Monday, ... 6 Saturday. Step back to Monday; Sunday steps
  // back six days, since it ends the week.
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
  return addDays(key, weekday === 0 ? -6 : 1 - weekday);
}

/**
 * How far a time zone is ahead of UTC at a given moment, in minutes (e.g. -300 for
 * Chicago in summer). Changes with daylight saving, so it is worked out per moment.
 * @param {Date} moment
 * @param {string} timeZone
 * @returns {number}
 */
function offsetMinutes(moment, timeZone) {
  // Write the moment as wall-clock parts in that zone, read those parts back as if they
  // were UTC, and the difference is the zone's offset.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(moment)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - moment.getTime()) / 60000);
}

/**
 * The UTC moment of a wall-clock time in a time zone, e.g. 9:00 on 2026-10-05 in
 * Chicago becomes "2026-10-05T14:00:00.000Z". Used to create shifts in the workplace zone.
 *
 * Twice a year daylight saving makes a wall-clock time tricky (US dates for 2026):
 * - Spring forward (March 8): clocks jump from 2:00 to 3:00, so 2:30 never happens. Such
 *   a time is moved forward by the jump: 2:30 becomes 3:30 daylight time.
 * - Fall back (November 1): clocks go from 2:00 back to 1:00, so 1:30 happens twice. The
 *   first one (still daylight time) is used.
 * These are the same rules JavaScript's newer Temporal API calls "compatible".
 * @param {string} key "YYYY-MM-DD"
 * @param {string} time "HH:MM" on a 24-hour clock
 * @param {string} timeZone
 * @returns {string} an ISO 8601 moment in UTC
 */
export function zonedTimeToUtc(key, time, timeZone) {
  // The wall-clock time written as if it were UTC (milliseconds). The real moment is this
  // minus the zone's offset; the hard part is knowing which offset applies.
  const wall = new Date(`${key}T${time}:00Z`).getTime();

  // The zone's offset a day before and a day after. Time zones change their offset at most
  // once in two days, so the right offset is one of these two (the same one on most days).
  const day = 24 * 3600000;
  const before = offsetMinutes(new Date(wall - day), timeZone);
  const after = offsetMinutes(new Date(wall + day), timeZone);

  // Try each offset: it is right if the zone really has that offset at the resulting
  // moment. Checking the offset at the result, not at a first guess, is what keeps times
  // near a daylight-saving change from ending up an hour off.
  const matches = [...new Set([before, after])]
    .map((offset) => wall - offset * 60000)
    .filter((moment) => wall - offsetMinutes(new Date(moment), timeZone) * 60000 === moment)
    .sort((a, b) => a - b);

  // Both match: the time happens twice (fall back), so take the earlier. Neither matches:
  // the time falls in the spring-forward gap, so use the offset from before the jump,
  // which lands the same number of minutes after the jump (2:30 becomes 3:30).
  const moment = matches.length > 0 ? matches[0] : wall - before * 60000;
  return new Date(moment).toISOString();
}

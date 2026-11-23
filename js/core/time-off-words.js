// Time off in plain words, shared by My time off and the review screen
// (docs/features/time-off.md): a request's status, and its days.

/** @typedef {import("../api/time-off.js").TimeOff} TimeOff */

/**
 * A request's status in plain words.
 * @param {TimeOff} request
 */
export function statusText(request) {
  switch (request.status) {
    case "pending":
      return "Waiting for review";
    case "escalated":
      return "Moved up: your managers disagreed, so someone above them decides";
    case "approved":
      return "Approved";
    case "denied":
      return request.not_reviewed ? "Declined: not reviewed in time" : "Declined";
    default:
      return "Cancelled";
  }
}

/**
 * The days, in words: "Monday, November 23" or "Mon, Nov 23 to Fri, Nov 27 (5 days)".
 * @param {string} first
 * @param {string} last
 */
export function dayRange(first, last) {
  /** @param {string} key @param {Intl.DateTimeFormatOptions} options */
  const format = (key, options) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(
      new Date(`${key}T12:00:00Z`),
    );
  if (first === last) return format(first, { weekday: "long", month: "long", day: "numeric" });
  /** @type {Intl.DateTimeFormatOptions} */
  const short = { weekday: "short", month: "short", day: "numeric" };
  return `${format(first, short)} to ${format(last, short)} (${daysIn(first, last)} days)`;
}

/**
 * How many days from first to last, both included.
 * @param {string} first
 * @param {string} last
 */
export function daysIn(first, last) {
  return (
    Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000) + 1
  );
}

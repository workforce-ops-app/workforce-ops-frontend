// Time off in plain words, shared by My time off and the review screen
// (docs/features/time-off.md): a request's status, and its days.

import { currentSession } from "./session.js";
import { dayKey, formatTimeRange } from "./time.js";

/** @typedef {import("../api/time-off.js").TimeOff} TimeOff */

/**
 * A request's status in plain words. A request still open says who has decided so far
 * and who it is waiting for (found in review: after one of two managers declined, it
 * still read "Waiting for review", as if nobody had looked at it).
 * @param {TimeOff} request
 */
export function statusText(request) {
  switch (request.status) {
    case "collecting":
      // Asked with "Offer Shift Swap / Coverage": still with the coworkers (coverage.md).
      return "Collecting coworkers' offers";
    case "pending":
      // Nobody has decided yet: name who will (when the API says), else the plain words.
      if (!request.progress?.decided.length) {
        const who = namesList(request.progress?.waiting_for ?? []);
        return who ? `Waiting for review by ${who}` : "Waiting for review";
      }
      return progressText(request);
    case "escalated":
      return [
        "Moved up: your managers disagreed, so someone above them decides.",
        waitingText(request),
      ]
        .filter(Boolean)
        .join(" ");
    case "approved":
      return "Approved";
    case "denied":
      return request.not_reviewed ? "Declined: not reviewed in time" : "Declined";
    default:
      return "Cancelled";
  }
}

/**
 * What each reviewer decided so far, then who is still to decide, e.g. "You declined.
 * Waiting for Felix Grant." The signed-in person's own decision reads "You", so a
 * reviewer sees at once that they already acted. Empty for a settled request.
 * @param {TimeOff} request
 */
export function progressText(request) {
  return [decidedText(request), waitingText(request)].filter(Boolean).join(" ");
}

/**
 * The decisions so far, one sentence each: "You declined." or "Ana Diaz approved."
 * @param {TimeOff} request
 */
export function decidedText(request) {
  // Step 1: who is signed in, so their own decision says "You".
  const me = currentSession()?.user.id;
  // Step 2: one short sentence per decision, oldest first, as the API lists them.
  return (request.progress?.decided ?? [])
    .map((step) => {
      const who = step.approver_id === me ? "You" : step.approver_name;
      return `${who} ${step.decision === "approve" ? "approved" : "declined"}.`;
    })
    .join(" ");
}

/**
 * Who the request still waits for: "Waiting for Felix Grant." (empty when nobody is left
 * or the request is settled).
 * @param {TimeOff} request
 */
export function waitingText(request) {
  const who = namesList(request.progress?.waiting_for ?? []);
  return who ? `Waiting for ${who}.` : "";
}

/**
 * Names joined as in a sentence: "A", "A and B", "A, B, and C". The names are written by
 * users, so callers put the result in the page as text only (el(..., { text })).
 * @param {{ display_name: string }[]} people
 */
function namesList(people) {
  const names = people.map((person) => person.display_name);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
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

// --- Swaps and coverage (docs/features/coverage.md) ----------------------------------------

/**
 * When a shift is, in words: "Tuesday, November 24, 8:00 AM - 4:00 PM".
 * @param {{ starts_at: string, ends_at: string }} shift
 * @param {string} zone the workplace's time zone
 */
export function shiftWhen(shift, zone) {
  const day = dayKey(new Date(shift.starts_at), zone);
  return `${dayRange(day, day)}, ${formatTimeRange(shift.starts_at, shift.ends_at, zone)}`;
}

/**
 * One coworker's answer in words, e.g. "Ben Okafor offers to cover" or "Ana Diaz offers a
 * swap: Friday, November 27, 7:00 AM - 3:00 PM". The name is user text: callers put the
 * result in the page as text only.
 * @param {import("../api/time-off.js").Offer} offer
 * @param {string} zone
 * @param {boolean} [mine] the signed-in person's own answer ("You ...")
 */
export function answerText(offer, zone, mine = false) {
  const who = mine ? "You" : offer.offered_by_name;
  if (offer.answer === "decline") return `${who} declined`;
  if (offer.answer === "cover") return `${who} ${mine ? "offer" : "offers"} to cover`;
  const given = offer.swap_shift ? `: ${shiftWhen(offer.swap_shift, zone)}` : "";
  return `${who} ${mine ? "offer" : "offers"} a swap${given}`;
}

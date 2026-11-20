// The parts of the home screen (My week) that depend on what the person does
// (docs/features/schedules.md, "Home screen"; decision 0038):
//
// - My time off, for people who can ask for it: the requests still waiting for a decision
//   and the approved time off still to come, soonest first.
// - Needs your attention, for people who review time off or plan the week: how many
//   requests wait for them, and the open shifts and open hours in their own department
//   this week.
//
// Only the builders live here; js/pages/my-shifts.js loads the data and decides which
// parts to show. Every text goes on the page with el(), never as HTML.

import { el } from "../core/dom.js";
import { roundHours } from "../core/time.js";
import { dayRange, statusText } from "../core/time-off-words.js";
import { statTile } from "./stat-tile.js";

/** @typedef {import("../api/time-off.js").TimeOff} TimeOff */

/** How many requests the home screen lists; the rest are on the Time off page. */
export const HOME_TIME_OFF = 3;

/**
 * The requests worth showing on the home screen, soonest first: the ones still waiting
 * for a decision (pending, or moved up to a higher manager), and approved time off that has
 * not ended yet. Denied, cancelled, and past time off stay on the Time off page.
 * @param {TimeOff[]} requests the person's own requests, in any order
 * @param {string} todayKey today in the workplace's time zone, "YYYY-MM-DD"
 * @returns {TimeOff[]} at most HOME_TIME_OFF
 */
export function upcomingTimeOff(requests, todayKey) {
  return (
    requests
      .filter(
        (r) =>
          r.status === "collecting" ||
          r.status === "pending" ||
          r.status === "escalated" ||
          // Day keys in the same format compare correctly as text.
          (r.status === "approved" && r.last_day >= todayKey),
      )
      // Soonest first; the keys sort as text for the same reason.
      .sort((a, b) => a.first_day.localeCompare(b.first_day))
      .slice(0, HOME_TIME_OFF)
  );
}

/**
 * One request as a list item: its days, then its status in plain words.
 * @param {TimeOff} request
 * @returns {HTMLElement}
 */
export function timeOffItem(request) {
  // Waiting requests get the amber edge, so they stand out from approved ones; the status
  // words say the same thing, so colour is never the only sign.
  const waiting = request.status !== "approved";
  return el(
    "li",
    { className: waiting ? "home-time-off home-time-off--waiting" : "home-time-off" },
    [
      el("p", {
        className: "home-time-off__days",
        text: dayRange(request.first_day, request.last_day),
      }),
      el("p", { className: "home-time-off__status", text: statusText(request) }),
    ],
  );
}

/**
 * The tiles of the attention panel. Each part is left out when the person may not see it
 * (null), so an employee who only reviews time off never gets empty shift tiles.
 * @param {{ waiting: number | null, open: number | null, openHours: number | null }} counts
 * @returns {HTMLElement[]}
 */
export function attentionTiles(counts) {
  /** @type {HTMLElement[]} */
  const tiles = [];
  if (counts.waiting !== null) {
    // The menu caps its count at 200 (one page of the list); the tile says the same.
    const value = counts.waiting >= 200 ? "200+" : counts.waiting;
    tiles.push(statTile("Time off to review", value, { attention: counts.waiting > 0 }));
  }
  if (counts.open !== null) {
    tiles.push(statTile("Open shifts this week", counts.open, { attention: counts.open > 0 }));
  }
  if (counts.openHours !== null) {
    tiles.push(
      statTile("Open hours this week", roundHours(counts.openHours), {
        attention: counts.openHours > 0,
      }),
    );
  }
  return tiles;
}

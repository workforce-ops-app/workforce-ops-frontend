// One shift inside a day card, kept simple: a round icon, the time in bold, who works it
// (department week only), small "Event" and "Notes" markers when the shift has them, and
// a chevron. It is a button: clicking it opens the shift's details in a popup
// (js/components/shift-dialog.js), so the week stays easy to scan.
// Used by My week and the department week; the week grid reuses the markers.
//
// Names are written by users, so everything goes through el(), which only ever sets text:
// a name containing <script> shows those characters and never runs (stored cross-site
// scripting, threat T5). The details in the popup are handled the same way.

import { el } from "../core/dom.js";
import { formatTimeRange } from "../core/time.js";
import { opensShift } from "./shift-dialog.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */

/**
 * A decorative icon (styled in css/base/base.css); the text beside it carries the meaning,
 * so screen readers skip it.
 * @param {string} name e.g. "clock"
 * @returns {HTMLElement}
 */
export function icon(name) {
  return el("span", { className: `icon icon--${name}`, attrs: { "aria-hidden": "true" } });
}

/**
 * The round icon at the start of a shift row.
 * @param {string} name
 * @returns {HTMLElement}
 */
function roundIcon(name) {
  return el("span", { className: "shift__icon" }, [icon(name)]);
}

/**
 * Small markers for what a shift carries besides its time: an event, notes, or both. They
 * tell people which shifts are worth opening; the event and notes themselves stay in the
 * popup, so the week stays short.
 * @param {Shift} shift
 * @param {{ compact?: boolean }} [options] compact: icons only, for the grid's narrow
 *   cells; the words are then kept for screen readers only
 * @returns {HTMLElement | null} null when the shift has neither
 */
export function shiftExtras(shift, options = {}) {
  /** @type {[string, string][]} icon name and word for each marker */
  const markers = [];
  if (shift.event_name) markers.push(["event", "Event"]);
  if (shift.notes) markers.push(["note", "Notes"]);
  if (markers.length === 0) return null;

  return el(
    "span",
    { className: "shift-extras" },
    markers.map(([name, word]) =>
      el("span", { className: "shift-extras__item" }, [
        // The icon is decorative; the word next to it says what it means, so the marker
        // never depends on the picture alone.
        icon(name),
        el("span", { className: options.compact ? "visually-hidden" : undefined, text: word }),
      ]),
    ),
  );
}

/**
 * The row for one shift: a button that opens its details.
 * @param {Shift} shift
 * @param {{ showEmployee?: boolean }} [options] show who works it (the department week);
 *   My week leaves it out, since every shift there is yours
 * @returns {HTMLElement}
 */
export function shiftRow(shift, options = {}) {
  // Open shifts (nobody assigned yet) get their own class and icon, so they stand out.
  const isOpen = shift.status === "open";

  // Inside a button only inline elements are allowed, so the lines are <span>s that the
  // stylesheet stacks.
  const text = el("span", { className: "shift__text" }, [
    // The time, in the shift's workplace zone.
    el("span", {
      className: "shift__time",
      text: formatTimeRange(shift.starts_at, shift.ends_at, shift.timezone),
    }),
  ]);

  // Who works it, in the department week; an open shift says so in words.
  if (options.showEmployee) {
    text.append(
      el("span", {
        className: "shift__who",
        text: shift.employee ? shift.employee.display_name : "Open shift",
      }),
    );
  }

  // A last line with the markers, when the shift has an event or notes.
  const extras = shiftExtras(shift);
  if (extras) text.append(extras);

  const button = el(
    "button",
    { className: isOpen ? "shift shift--open" : "shift", attrs: { type: "button" } },
    [roundIcon(isOpen ? "open" : "clock"), text, icon("chevron-right")],
  );
  return opensShift(button, shift);
}

/**
 * The row for a day without shifts: a lounge chair and "No shift". Not a button, since
 * there is nothing to open.
 * @returns {HTMLElement}
 */
export function noShiftRow() {
  return el("div", { className: "shift shift--none" }, [
    roundIcon("lounge"),
    el("span", { className: "shift__text" }, [
      el("span", { className: "shift__time", text: "No shift" }),
    ]),
  ]);
}

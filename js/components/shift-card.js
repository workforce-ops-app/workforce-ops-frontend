// One shift as a card: its time, who works it (or "Open shift"), and its details, notes,
// and event. Used by My shifts and the department week.
//
// Details, notes, and event text are written by users, so everything goes through el(),
// which only ever sets text: a note containing <script> shows those characters and never
// runs (stored cross-site scripting, threat T5).

import { el } from "../core/dom.js";
import { formatTimeRange } from "../core/time.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */

/**
 * Build the card for one shift.
 * @param {Shift} shift
 * @param {{ showDepartment?: boolean }} [options] show the department name (My shifts
 *   lists several departments; the week view is one department)
 * @returns {HTMLElement}
 */
export function shiftCard(shift, options = {}) {
  // Open shifts get an extra class, so the week view can highlight them.
  const isOpen = shift.status === "open";
  const card = el("article", { className: isOpen ? "shift-card shift-card--open" : "shift-card" });

  // The time, in the shift's workplace zone.
  card.append(
    el("p", {
      className: "shift-card__time",
      text: formatTimeRange(shift.starts_at, shift.ends_at, shift.timezone),
    }),
  );

  // Who works it, or "Open shift" when nobody is assigned yet.
  card.append(
    el("p", {
      className: isOpen ? "shift-card__who shift-card__who--open" : "shift-card__who",
      text: shift.employee ? shift.employee.display_name : "Open shift",
    }),
  );

  // What the shift is, and where (only when asked to show the department).
  const what = [shift.details, options.showDepartment ? shift.department.name : null]
    .filter(Boolean)
    .join(" · ");
  if (what) card.append(el("p", { className: "shift-card__details", text: what }));

  // A special event during the shift, with its description if there is one.
  if (shift.event_name) {
    card.append(el("p", { className: "shift-card__event", text: `Event: ${shift.event_name}` }));
    if (shift.event_description) {
      card.append(el("p", { className: "shift-card__note", text: shift.event_description }));
    }
  }

  // Instructions for whoever works it.
  if (shift.notes) card.append(el("p", { className: "shift-card__note", text: shift.notes }));

  return card;
}

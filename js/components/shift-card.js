// One shift inside a day card: a round icon, the time in bold, and who or what underneath,
// plus the event and notes when there are any. Used by My week and the department week.
//
// Details, notes, event text, and names are written by users, so everything goes through
// el(), which only ever sets text: a note containing <script> shows those characters and
// never runs (stored cross-site scripting, threat T5).

import { el } from "../core/dom.js";
import { formatTimeRange } from "../core/time.js";

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
 * The row for one shift.
 * @param {Shift} shift
 * @param {{ showEmployee?: boolean }} [options] show who works it (the department week);
 *   My week shows the role and department instead, since every shift there is yours
 * @returns {HTMLElement}
 */
export function shiftRow(shift, options = {}) {
  // Open shifts (nobody assigned yet) get their own class and icon, so they stand out.
  const isOpen = shift.status === "open";
  const text = el("div", { className: "shift__text" });

  // The time, in the shift's workplace zone.
  text.append(
    el("p", {
      className: "shift__time",
      text: formatTimeRange(shift.starts_at, shift.ends_at, shift.timezone),
    }),
  );

  // Underneath: who works it (department week) or what and where (My week), joined by a
  // dot, e.g. "Ben Okafor · Grill" or "Prep line · Kitchen".
  if (options.showEmployee) {
    text.append(
      el("p", { className: "shift__meta" }, [
        el("span", {
          className: "shift__who",
          text: shift.employee ? shift.employee.display_name : "Open shift",
        }),
        ...(shift.details ? [` · ${shift.details}`] : []),
      ]),
    );
  } else {
    const meta = [shift.details, shift.department.name].filter(Boolean).join(" · ");
    text.append(el("p", { className: "shift__meta", text: meta }));
  }

  // A special event during the shift, with its description if there is one.
  if (shift.event_name) {
    text.append(el("p", { className: "shift__event", text: `Event: ${shift.event_name}` }));
    if (shift.event_description) {
      text.append(el("p", { className: "shift__note", text: shift.event_description }));
    }
  }

  // Instructions for whoever works it.
  if (shift.notes) text.append(el("p", { className: "shift__note", text: shift.notes }));

  return el("div", { className: isOpen ? "shift shift--open" : "shift" }, [
    roundIcon(isOpen ? "open" : "clock"),
    text,
  ]);
}

/**
 * The row for a day without shifts: a lounge chair and "No shift".
 * @returns {HTMLElement}
 */
export function noShiftRow() {
  return el("div", { className: "shift shift--none" }, [
    roundIcon("lounge"),
    el("div", { className: "shift__text" }, [
      el("p", { className: "shift__time", text: "No shift" }),
    ]),
  ]);
}

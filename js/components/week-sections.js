// The two sections under the department week:
// - Open shifts: the week's shifts nobody is assigned to yet, in time order. Filling them
//   is a manager's first job, so they get a section of their own instead of a row in the
//   grid. Each one is a button that opens the details popup, like every shift.
// - Unscheduled employees: the department's people without any shift that week, so a
//   manager can see at once who is still free to take one.
//
// Names, roles, and event text are written by users, so everything goes through el(),
// which only ever sets text (stored cross-site scripting, threat T5).

import { el } from "../core/dom.js";
import { dayKey, formatDayHeading, formatTimeRange } from "../core/time.js";
import { icon, shiftExtras } from "./shift-card.js";
import { opensShift } from "./shift-dialog.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */
/** @typedef {import("../api/shifts.js").EmployeeRef} EmployeeRef */

/**
 * A section's heading with a count, e.g. "Open shifts 2". The count is a separate element
 * so it can be styled as a badge; screen readers read "Open shifts 2".
 * @param {string} id the heading's ID, which names the section for screen readers
 * @param {string} text
 * @param {number} count
 * @returns {HTMLElement}
 */
function sectionHeading(id, text, count) {
  return el("h2", { className: "week-section__title", attrs: { id } }, [
    text,
    " ",
    el("span", { className: "week-section__count", text: count }),
  ]);
}

/**
 * One open shift: the day, the time, and the role, as a button that opens its details.
 * @param {Shift} shift
 * @returns {HTMLElement}
 */
function openShiftItem(shift) {
  const button = el("button", { className: "open-shift", attrs: { type: "button" } }, [
    // Amber icon and the word "Open" in the popup: never colour alone.
    icon("open"),
    el("span", { className: "open-shift__text" }, [
      el("span", {
        className: "open-shift__day",
        text: formatDayHeading(dayKey(shift.starts_at, shift.timezone)),
      }),
      el("span", {
        className: "open-shift__time",
        text: formatTimeRange(shift.starts_at, shift.ends_at, shift.timezone),
      }),
      ...(shift.details
        ? [el("span", { className: "open-shift__role", text: shift.details })]
        : []),
    ]),
  ]);
  const extras = shiftExtras(shift);
  if (extras) button.append(extras);
  return opensShift(button, shift);
}

/**
 * The open shifts section.
 * @param {Shift[]} shifts the week's shifts (no cancelled ones); only the open ones are shown
 * @returns {HTMLElement}
 */
export function openShiftsSection(shifts) {
  // Already in time order from the API; open means nobody is assigned.
  const open = shifts.filter((s) => !s.employee);
  const content = open.length
    ? el(
        "ul",
        { className: "open-shifts" },
        open.map((s) => el("li", {}, [openShiftItem(s)])),
      )
    : el("p", { className: "week-section__empty", text: "No open shifts this week." });

  return el(
    "section",
    {
      className: "week-section week-section--open",
      attrs: { "aria-labelledby": "open-shifts-title" },
    },
    [sectionHeading("open-shifts-title", "Open shifts", open.length), content],
  );
}

/**
 * The department's people who have no shift in the week, by name.
 * @param {EmployeeRef[]} people everyone in the department
 * @param {Shift[]} shifts the week's shifts
 * @returns {EmployeeRef[]}
 */
export function unscheduledPeople(people, shifts) {
  const working = new Set(shifts.map((s) => s.employee?.id).filter(Boolean));
  return people
    .filter((person) => !working.has(person.id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/**
 * The unscheduled employees section: one name tag per person.
 * @param {EmployeeRef[]} people everyone in the department
 * @param {Shift[]} shifts the week's shifts
 * @returns {HTMLElement}
 */
export function unscheduledSection(people, shifts) {
  const free = unscheduledPeople(people, shifts);
  const content = free.length
    ? el(
        "ul",
        { className: "people-tags" },
        free.map((person) => el("li", { className: "people-tag", text: person.display_name })),
      )
    : el("p", { className: "week-section__empty", text: "Everyone has a shift this week." });

  return el(
    "section",
    { className: "week-section", attrs: { "aria-labelledby": "unscheduled-title" } },
    [sectionHeading("unscheduled-title", "Unscheduled employees", free.length), content],
  );
}

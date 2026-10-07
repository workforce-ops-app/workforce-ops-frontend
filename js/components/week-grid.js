// The department week as a grid, for managers planning on a laptop: one row per person,
// one column per day, and each person's hours at the end of the row. Open shifts (nobody
// assigned yet) get their own row at the top, because filling them is the first job.
// Used by the department week on wide screens; phones see the day cards instead.
//
// It is a real <table>, not a grid of <div>s: the header cells (<th scope="col"> for days,
// <th scope="row"> for people) let a screen reader say "Tuesday, Ben Okafor, 3:00 PM ..."
// for any cell, which a layout made of divs cannot do.
//
// Each shift shows only its time; clicking it opens the details popup
// (js/components/shift-dialog.js), so a busy week stays readable.
//
// Names, details, notes, and event text are written by users, so everything goes through
// el(), which only ever sets text (stored cross-site scripting, threat T5).

import { el } from "../core/dom.js";
import {
  formatDayHeading,
  formatDayNumber,
  formatTimeRange,
  formatWeekdayShort,
  hoursBetween,
  roundHours,
} from "../core/time.js";
import { groupByDay } from "./day-list.js";
import { icon } from "./shift-card.js";
import { opensShift } from "./shift-dialog.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */

/**
 * @typedef {{ key: string, label: string, isOpen: boolean, shifts: Shift[] }} GridRow
 *   one row of the grid: a person (or the open shifts) and their shifts that week
 */

/** The key of the open-shifts row; no person ID can look like it. */
const OPEN_ROW = "open";

/**
 * Sort a week's shifts into rows: the open shifts first (if there are any), then one row
 * per person, by name. Only people with a shift that week get a row, because the shifts
 * answer already carries their names (no separate request for people before the midterm).
 * @param {Shift[]} shifts
 * @returns {GridRow[]}
 */
export function gridRows(shifts) {
  /** @type {Map<string, GridRow>} */
  const rows = new Map();
  for (const shift of shifts) {
    const key = shift.employee ? shift.employee.id : OPEN_ROW;
    const row = rows.get(key) ?? {
      key,
      label: shift.employee ? shift.employee.display_name : "Open shifts",
      isOpen: !shift.employee,
      shifts: [],
    };
    row.shifts.push(shift);
    rows.set(key, row);
  }
  // Open shifts on top, then people in alphabetical order.
  return [...rows.values()].sort(
    (a, b) => Number(b.isOpen) - Number(a.isOpen) || a.label.localeCompare(b.label),
  );
}

/**
 * One shift inside a grid cell: just its time, as a button. The row already says who
 * works it; clicking opens everything else (role, event, notes) in the details popup.
 * @param {Shift} shift
 * @returns {HTMLElement}
 */
function gridShift(shift) {
  const isOpen = shift.status === "open";
  const button = el("button", {
    className: isOpen ? "grid-shift grid-shift--open" : "grid-shift",
    text: formatTimeRange(shift.starts_at, shift.ends_at, shift.timezone),
    attrs: { type: "button" },
  });
  return opensShift(button, shift);
}

/**
 * The header cell of a day: "MON" over "5", with the full date for screen readers.
 * @param {string} key "YYYY-MM-DD"
 * @param {boolean} isToday
 * @returns {HTMLElement}
 */
function dayHeader(key, isToday) {
  return el(
    "th",
    {
      className: isToday ? "week-grid__day week-grid__day--today" : "week-grid__day",
      attrs: { scope: "col" },
    },
    [
      // What sighted people see: a small weekday over a large date, like the day cards.
      el("span", {
        className: "week-grid__weekday",
        text: formatWeekdayShort(key),
        attrs: { "aria-hidden": "true" },
      }),
      el("span", {
        className: "week-grid__number",
        text: formatDayNumber(key),
        attrs: { "aria-hidden": "true" },
      }),
      // What screen readers hear instead: "Monday, October 5 (today)".
      el("span", {
        className: "visually-hidden",
        text: `${formatDayHeading(key)}${isToday ? " (today)" : ""}`,
      }),
    ],
  );
}

/**
 * The whole grid for one week.
 * @param {string[]} keys the week's seven day keys, Monday first
 * @param {Shift[]} shifts the department's shifts that week (no cancelled ones)
 * @param {{ today?: string }} [options] today (a day key) highlights today's column
 * @returns {HTMLElement}
 */
export function weekGrid(keys, shifts, options = {}) {
  const header = el("tr", {}, [
    el("th", { className: "week-grid__corner", text: "Person", attrs: { scope: "col" } }),
    ...keys.map((key) => dayHeader(key, key === options.today)),
    el("th", { className: "week-grid__hours", text: "Hours", attrs: { scope: "col" } }),
  ]);

  const rows = gridRows(shifts).map((row) => {
    const byDay = groupByDay(row.shifts);
    const hours = row.shifts.reduce((sum, s) => sum + hoursBetween(s.starts_at, s.ends_at), 0);

    // The row's name; the open-shifts row also gets an icon, so it is not marked by its
    // amber colour alone.
    // The icon and name sit in an inner span: a table cell itself must stay a table cell
    // (display: flex on it would break the row's lines).
    const name = el("th", { className: "week-grid__person", attrs: { scope: "row" } }, [
      el("span", { className: "week-grid__person-label" }, [
        ...(row.isOpen ? [icon("open")] : []),
        el("span", { text: row.label }),
      ]),
    ]);

    const cells = keys.map((key) => {
      const dayShifts = byDay.get(key) ?? [];
      const classes = ["week-grid__cell"];
      if (key === options.today) classes.push("week-grid__cell--today");
      // An empty cell still says something to a screen reader, instead of silence.
      const content = dayShifts.length
        ? dayShifts.map(gridShift)
        : [el("span", { className: "visually-hidden", text: "No shift" })];
      return el("td", { className: classes.join(" ") }, content);
    });

    return el("tr", { className: row.isOpen ? "week-grid__row--open" : "" }, [
      name,
      ...cells,
      el("td", { className: "week-grid__hours", text: roundHours(hours) }),
    ]);
  });

  // A row that says so when the week has no shifts at all.
  const body = rows.length
    ? rows
    : [
        el("tr", {}, [
          el("td", {
            className: "week-grid__empty",
            text: "No shifts planned this week.",
            attrs: { colspan: String(keys.length + 2) },
          }),
        ]),
      ];

  return el("table", { className: "week-grid" }, [
    el("caption", {
      className: "visually-hidden",
      text: "Shifts this week: one row per person, one column per day",
    }),
    el("thead", {}, [header]),
    el("tbody", {}, body),
  ]);
}

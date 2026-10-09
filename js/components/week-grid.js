// The department week as a grid, for managers planning on a laptop: one row per person,
// one column per day, and each person's hours at the end of the row. Open shifts (nobody
// assigned yet) are not in the grid: they get their own section below it
// (js/components/week-sections.js), so every row is a person.
// Used by the department week on wide screens; phones see the day cards instead.
//
// It is a real <table>, not a grid of <div>s: the header cells (<th scope="col"> for days,
// <th scope="row"> for people) let a screen reader say "Tuesday, Ben Okafor, 3:00 PM ..."
// for any cell, which a layout made of divs cannot do.
//
// One day's column is highlighted at a time: the day under the mouse (or holding keyboard
// focus), and today's when there is none, so the eye can follow a day down the grid.
//
// Each shift shows only its time, plus small markers when it has an event or notes;
// clicking it opens the details popup (js/components/shift-dialog.js), so a busy week
// stays readable.
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
import { shiftExtras } from "./shift-card.js";
import { opensShift } from "./shift-dialog.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */

/**
 * @typedef {{ key: string, label: string, shifts: Shift[] }} GridRow
 *   one row of the grid: a person and their shifts that week
 */

/** The class of the highlighted day's cells (header and body). */
const ACTIVE = "week-grid__col--active";

/**
 * Sort a week's assigned shifts into rows: one per person, by name. Open shifts are left
 * out (they have their own section). Only people with a shift that week get a row, because
 * the shifts answer already carries their names; the people without one are listed below
 * the grid.
 * @param {Shift[]} shifts
 * @returns {GridRow[]}
 */
export function gridRows(shifts) {
  /** @type {Map<string, GridRow>} */
  const rows = new Map();
  for (const shift of shifts) {
    if (!shift.employee) continue;
    const row = rows.get(shift.employee.id) ?? {
      key: shift.employee.id,
      label: shift.employee.display_name,
      shifts: [],
    };
    row.shifts.push(shift);
    rows.set(row.key, row);
  }
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * One shift inside a grid cell: its time, and icons for an event or notes, as a button.
 * The row already says who works it; clicking opens everything else (role, event, notes)
 * in the details popup.
 * @param {Shift} shift
 * @returns {HTMLElement}
 */
function gridShift(shift) {
  const button = el("button", { className: "grid-shift", attrs: { type: "button" } }, [
    el("span", {
      className: "grid-shift__time",
      text: formatTimeRange(shift.starts_at, shift.ends_at, shift.timezone),
    }),
  ]);
  // Icons only: a cell is narrow. The words ("Event", "Notes") stay for screen readers.
  const extras = shiftExtras(shift, { compact: true });
  if (extras) button.append(extras);
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
      // data-day names the column, for the highlight below.
      attrs: { scope: "col", "data-day": key },
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
 * Highlight one day's column, header included, and no other.
 * @param {HTMLElement} table
 * @param {string | undefined} key the day to highlight; undefined highlights none
 */
export function highlightDay(table, key) {
  for (const cell of table.querySelectorAll("[data-day]")) {
    cell.classList.toggle(ACTIVE, cell instanceof HTMLElement && cell.dataset.day === key);
  }
}

/**
 * Make the highlight follow the mouse and keyboard focus, and fall back to today.
 * The highlight is only a visual aid: a screen reader already hears each cell's day from
 * its column header, so nothing here changes what it reads.
 * @param {HTMLElement} table
 * @param {string | undefined} today
 */
function followPointer(table, today) {
  // The day of the cell an event happened in, or today outside the day columns (the names
  // and hours columns).
  const dayOf = (/** @type {Event} */ event) => {
    const target = event.target instanceof Element ? event.target : null;
    const cell = target?.closest("[data-day]");
    return cell instanceof HTMLElement ? cell.dataset.day : today;
  };

  table.addEventListener("pointerover", (event) => highlightDay(table, dayOf(event)));
  table.addEventListener("pointerleave", () => highlightDay(table, today));
  table.addEventListener("focusin", (event) => highlightDay(table, dayOf(event)));
  table.addEventListener("focusout", (event) => {
    // Only when focus leaves the grid; moving between shifts is handled by focusin.
    if (!(event.relatedTarget instanceof Node && table.contains(event.relatedTarget))) {
      highlightDay(table, today);
    }
  });
}

/**
 * The whole grid for one week.
 * @param {string[]} keys the week's seven day keys, Monday first
 * @param {Shift[]} shifts the department's shifts that week (no cancelled ones); open ones
 *   are left out of the grid
 * @param {{ today?: string }} [options] today (a day key) marks today's column
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

    const name = el("th", {
      className: "week-grid__person",
      text: row.label,
      attrs: { scope: "row" },
    });

    const cells = keys.map((key) => {
      const dayShifts = byDay.get(key) ?? [];
      // An empty cell still says something to a screen reader, instead of silence.
      const content = dayShifts.length
        ? dayShifts.map(gridShift)
        : [el("span", { className: "visually-hidden", text: "No shift" })];
      return el("td", { className: "week-grid__cell", attrs: { "data-day": key } }, content);
    });

    return el("tr", {}, [
      name,
      ...cells,
      el("td", { className: "week-grid__hours", text: roundHours(hours) }),
    ]);
  });

  // A row that says so when nobody has a shift this week.
  const body = rows.length
    ? rows
    : [
        el("tr", {}, [
          el("td", {
            className: "week-grid__empty",
            text: "Nobody is scheduled this week.",
            attrs: { colspan: String(keys.length + 2) },
          }),
        ]),
      ];

  const table = el("table", { className: "week-grid" }, [
    el("caption", {
      className: "visually-hidden",
      text: "Shifts this week: one row per person, one column per day",
    }),
    el("thead", {}, [header]),
    el("tbody", {}, body),
  ]);

  // Today's column starts highlighted; the mouse and keyboard move the highlight.
  highlightDay(table, options.today);
  followPointer(table, options.today);
  return table;
}

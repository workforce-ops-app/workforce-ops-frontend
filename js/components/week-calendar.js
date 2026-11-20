// The department week as a calendar, for managers planning on a laptop
// (workforce-ops-app/workforce-ops-frontend#82), laid out like the week view of Google
// Calendar that most people already know: the seven days across the top, the 24 hours of
// the day down the left side, and each shift drawn as a coloured block in its day's column,
// from its start down to its end. Each person has their own colour
// (js/components/person-colour.js), and every block also shows the person's name, so the
// colour is never the only way to tell people apart.
//
// Open shifts (nobody assigned yet) are not in the calendar: they get their own section
// below it (js/components/week-sections.js). Phones see the day cards instead
// (css/pages/schedule.css shows one or the other).
//
// How the calendar is built:
// - One CSS grid: a corner and the seven day headers on the first row, then the hour
//   labels and the seven day columns. The whole grid scrolls up and down inside its card
//   (the day is 24 hours tall), and the day headers stay pinned at the top while it does.
// - Each day column is a list of that day's blocks, labelled with the full date, so a
//   screen reader hears "Monday, October 5, list, 3 items" and then each shift in time
//   order. The visible headers and hour labels are only a picture for sighted people, so
//   screen readers skip them.
// - A night shift (10:00 PM to 6:00 AM) is drawn in two pieces: the evening piece in its
//   own day, to midnight, and the morning piece at the top of the next day. Each piece is
//   cut square and dashed where it continues. A shift belongs to the day it starts, so only
//   the first piece is a real button with a description (and a select box in edit mode);
//   the morning piece is an echo that screen readers skip, which still opens the details
//   when clicked.
// - Shifts that overlap in time on the same day sit side by side, each narrower, like in
//   Google Calendar (assignColumns below).
// - A red line across today's column marks the time it is now, with a dot where it starts,
//   as in Google Calendar (placeNowLine below). The page moves it every minute
//   (followNow), and it is only a picture: screen readers skip it.
//
// How a block is placed, and why it is safe with our Content Security Policy:
// - The page's policy is style-src 'self', so style="..." attributes (and any HTML that
//   carries them) are refused by the browser. That stops an attacker who manages to inject
//   markup from restyling the page, for example to hide a warning.
// - So the script never writes a style attribute. It sets four CSS custom properties
//   through the DOM (element.style.setProperty, the CSSOM, which the policy allows because
//   only our own script can call it): --block-start and --block-length, as percentages of
//   the day, and --block-column and --block-columns, for blocks side by side.
//   css/components/week-calendar.css turns them into top, height, left, and width.
// - The numbers come from the shift's times, which the server sends; no text a user wrote
//   ever reaches a style. The colour is a class name made from a number (0 to 11).
//
// Positions use wall-clock time in the workplace zone, the same clock as the hour labels:
// a shift from 9:00 to 17:00 always covers 9:00 to 17:00 of its day. On the night the
// clocks fall back, a 10:00 PM to 6:00 AM shift lasts 9 real hours but is drawn over the
// 8 hours of the clock face.
//
// Names, details, notes, and event text are written by users, so everything goes through
// el(), which only ever sets text (stored cross-site scripting, threat T5).

import { el } from "../core/dom.js";
import {
  clockTime,
  compactTime,
  dayKey,
  daysLater,
  formatDayHeading,
  formatDayNumber,
  formatWeekdayShort,
  wallTime,
} from "../core/time.js";
import { personColourClass } from "./person-colour.js";
import { shiftExtras } from "./shift-card.js";
import { openShiftDialog, opensShift } from "./shift-dialog.js";
import { shiftTime } from "./shift-time.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */

/**
 * Where a shift sits in the week, in minutes from Monday 00:00 (wall-clock time).
 * @typedef {{
 *   start: number, end: number, startedBefore: boolean, continuesAfter: boolean,
 * }} WeekSpan
 *   start and end are clamped to the week; the two flags say whether the shift really
 *   started before Monday or runs on past Sunday midnight
 */

/**
 * One piece of a shift inside one day: most shifts are one piece, a night shift two.
 * @typedef {{
 *   day: number, start: number, end: number, first: boolean,
 *   continued: boolean, continues: boolean,
 * }} DayPiece
 *   day: which day of the week (0 is Monday); start and end: minutes after that day's
 *   midnight (end is at most 1440, midnight at the end of the day); first: the shift's
 *   first piece this week (the real button); continued: the shift was already going at
 *   the top of the piece (it started the day before); continues: it goes on past the
 *   bottom (into the next day, or into next week on Sunday)
 */

/** Minutes in a day, and in the whole week the calendar shows. */
const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;

/** Where the calendar opens when the week has no shifts: 6 AM. */
const DEFAULT_FIRST_HOUR = 6;

/**
 * How many minutes after Monday 00:00 a moment is, on the workplace's wall clock.
 * @param {string} moment an ISO 8601 moment (UTC from the API)
 * @param {string} timeZone the shift's workplace zone
 * @param {string} monday the week's Monday, "YYYY-MM-DD"
 * @returns {number} negative before the week, WEEK_MINUTES or more after it
 */
export function minutesIntoWeek(moment, timeZone, monday) {
  // Step 1: which day it is in the workplace zone, counted from Monday (0) to Sunday (6).
  // Both day keys are read as UTC midnights, where every day has exactly 24 hours, so the
  // difference divides evenly into days even across a daylight-saving change.
  const day = dayKey(moment, timeZone);
  const dayIndex = Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`)) / (DAY_MINUTES * 60000),
  );
  // Step 2: the wall-clock time on that day ("22:30"), as minutes since midnight.
  const [hour, minute] = wallTime(moment, timeZone).split(":").map(Number);
  // Step 3: whole days before it, plus the time into its own day.
  return dayIndex * DAY_MINUTES + hour * 60 + minute;
}

/**
 * Where a shift goes in the week, clamped to the week the calendar shows.
 * @param {Shift} shift
 * @param {string} monday the week's Monday, "YYYY-MM-DD"
 * @returns {WeekSpan}
 */
export function weekSpan(shift, monday) {
  const rawStart = minutesIntoWeek(shift.starts_at, shift.timezone, monday);
  const rawEnd = minutesIntoWeek(shift.ends_at, shift.timezone, monday);
  // A Sunday night shift runs past the end of the week, and a shift from the Sunday
  // before could reach into Monday morning: draw only the part inside this week and keep
  // a note of the rest, so the block can say it continues.
  const start = Math.max(rawStart, 0);
  // At least one minute long, so a block never vanishes. (The server refuses shifts
  // without a length, but on the night the clocks spring forward the wall clock jumps, so
  // 2:00 to 3:00 can read as no time at all.)
  const end = Math.max(Math.min(rawEnd, WEEK_MINUTES), start + 1);
  return { start, end, startedBefore: rawStart < 0, continuesAfter: rawEnd > WEEK_MINUTES };
}

/**
 * Cut a shift's place in the week into one piece per day it touches, at each midnight.
 * A day shift gives one piece; a 10:00 PM to 6:00 AM shift gives two, 22:00 to 24:00 on
 * its own day and 0:00 to 6:00 on the next.
 * @param {WeekSpan} span
 * @returns {DayPiece[]}
 */
export function dayPieces(span) {
  // Step 1: the first and the last day the shift touches. The end minute itself is not
  // part of the shift (a shift ending at midnight does not touch the next day), hence
  // end - 1.
  const firstDay = Math.floor(span.start / DAY_MINUTES);
  const lastDay = Math.floor((span.end - 1) / DAY_MINUTES);
  /** @type {DayPiece[]} */
  const pieces = [];
  for (let day = firstDay; day <= lastDay; day += 1) {
    // Step 2: the part of the shift inside this day, as minutes after this day's midnight.
    const midnight = day * DAY_MINUTES;
    const start = Math.max(span.start, midnight) - midnight;
    const end = Math.min(span.end, midnight + DAY_MINUTES) - midnight;
    // Step 3: whether it was already going at the top of the day (from the day before, or
    // from last week), and whether it goes on past the bottom (into the next day, or
    // into next week).
    const isFirst = day === firstDay;
    const isLast = day === lastDay;
    pieces.push({
      day,
      start,
      end,
      first: isFirst,
      continued: !isFirst || span.startedBefore,
      continues: !isLast || span.continuesAfter,
    });
  }
  return pieces;
}

/**
 * Give each item a lane, so items that overlap in time get different lanes instead of
 * sitting on top of each other. The calendar uses lanes as columns side by side.
 * @param {{ start: number, end: number }[]} spans
 * @returns {{ lanes: number[], count: number }} each item's lane (0 is the first) and how
 *   many lanes they need
 */
export function assignLanes(spans) {
  // Step 1: look at the items from the earliest start to the latest.
  const order = spans.map((_, index) => index).sort((a, b) => spans[a].start - spans[b].start);
  /** @type {number[]} where each lane is free again (the end of its last item) */
  const laneEnds = [];
  /** @type {number[]} */
  const lanes = new Array(spans.length).fill(0);
  for (const index of order) {
    // Step 2: the first lane whose last item has ended by the time this one starts.
    let lane = laneEnds.findIndex((end) => end <= spans[index].start);
    // Step 3: none is free, so open a new lane next to the others.
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = spans[index].end;
    lanes[index] = lane;
  }
  return { lanes, count: Math.max(laneEnds.length, 1) };
}

/**
 * Columns for one day's blocks, the way Google Calendar does it. Blocks that overlap, and
 * every block linked to them through a chain of overlaps, form a group; each group is as
 * wide as the day and is shared out into as many columns as it needs. A block that
 * overlaps nothing keeps the whole width of the day, even when other parts of the same day
 * are crowded.
 * @param {{ start: number, end: number }[]} spans one day's blocks, in any order
 * @returns {{ columns: number[], counts: number[] }} for each block: its column (0 is the
 *   left) and how many columns its group is split into
 */
export function assignColumns(spans) {
  const columns = new Array(spans.length).fill(0);
  const counts = new Array(spans.length).fill(1);
  // Step 1: go through the blocks from the earliest start, collecting a group while each
  // block starts before the group's latest end.
  const order = spans.map((_, index) => index).sort((a, b) => spans[a].start - spans[b].start);
  /** @type {number[]} the blocks of the group being collected */
  let group = [];
  let groupEnd = -Infinity;

  // Step 2: a finished group shares its width: assignLanes gives each block a column, and
  // every block of the group learns how many columns there are.
  const finish = () => {
    const { lanes, count } = assignLanes(group.map((index) => spans[index]));
    group.forEach((index, position) => {
      columns[index] = lanes[position];
      counts[index] = count;
    });
  };

  for (const index of order) {
    // A block that starts once everything before it has ended begins a new group.
    if (group.length && spans[index].start >= groupEnd) {
      finish();
      group = [];
      groupEnd = -Infinity;
    }
    group.push(index);
    groupEnd = Math.max(groupEnd, spans[index].end);
  }
  if (group.length) finish();
  return { columns, counts };
}

/**
 * The hour the calendar opens at: the hour of the week's earliest start of a shift (any
 * day), or 6 AM when the week has none. Only real starts count: the morning piece of a
 * night shift starts at midnight only because the day does, and would otherwise always
 * open the calendar at midnight.
 * @param {DayPiece[]} pieces every piece of the week
 * @returns {number} 0 to 23
 */
export function firstHour(pieces) {
  const starts = pieces.filter((piece) => !piece.continued).map((piece) => piece.start);
  return starts.length ? Math.floor(Math.min(...starts) / 60) : DEFAULT_FIRST_HOUR;
}

/**
 * An hour of the day as the labels down the side show it: "12 AM", "9 AM", "12 PM", "5 PM".
 * @param {number} hour 0 to 23
 * @returns {string}
 */
function hourLabel(hour) {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * The whole time of a shift in words, for its tooltip: "10 PM - 6 AM (ends the next day)",
 * plus "(continues into next week)" or "(started the week before)" at the edges of the
 * week. Plain text in an attribute, never markup.
 * @param {Shift} shift
 * @param {WeekSpan} span
 * @returns {string}
 */
function fullTime(shift, span) {
  const zone = shift.timezone;
  let text = `${clockTime(shift.starts_at, zone)} - ${clockTime(shift.ends_at, zone)}`;
  if (daysLater(shift.starts_at, shift.ends_at, zone) >= 1) text += " (ends the next day)";
  if (span.startedBefore) text += " (started the week before)";
  if (span.continuesAfter) text += " (continues into next week)";
  return text;
}

/**
 * What a screen reader hears for a block: "Ana Diaz, Monday, October 5, 10:00 PM - 6:00 AM
 * (ends the next day)". The block on screen is only a coloured box with a name and a short
 * time, which says nothing without the column and the hour lines around it.
 * @param {Shift} shift
 * @param {WeekSpan} span
 * @returns {HTMLElement}
 */
function blockDescription(shift, span) {
  const person = shift.employee?.display_name ?? "";
  const day = formatDayHeading(dayKey(shift.starts_at, shift.timezone));
  const description = el("span", { className: "visually-hidden" }, [
    `${person}, ${day}, `,
    // The same full time as every other screen, with its own "(ends the next day)".
    shiftTime(shift, "week-calendar__full-time"),
  ]);
  // Said in words, since a dashed edge is only a picture.
  if (span.startedBefore) description.append(" (started the week before)");
  if (span.continuesAfter) description.append(" (continues into next week)");
  return description;
}

/**
 * What sighted people see on a block: the person's name on the first line, then the time
 * and the markers. The time comes in two lengths, and the stylesheet shows the one that
 * fits the block's own width (a container query, css/components/week-calendar.css):
 *   full    "9 AM - 5 PM"   most blocks
 *   short   "9a-5p"         narrow blocks (several shifts side by side)
 * The morning piece of a night shift says "until 6 AM" ("until 6a") instead, since its
 * start is on the day before. After the time come the markers: "+1" when the shift ends
 * the next day, and the event and notes icons (under the time when the block is narrow).
 *
 * The times and "+1" are hidden from screen readers, which hear the full description
 * instead (otherwise they would hear the time twice). The icons keep their words ("Event",
 * "Notes") for screen readers.
 * @param {Shift} shift
 * @param {DayPiece} piece
 * @returns {HTMLElement[]}
 */
function blockLabel(shift, piece) {
  const zone = shift.timezone;
  const name = el("span", {
    className: "calendar-shift__name",
    text: shift.employee?.display_name ?? "",
  });

  // The two lengths, each its own element; the stylesheet shows exactly one.
  const startsHere = !piece.continued;
  const lengths = [
    [
      "full",
      startsHere
        ? `${clockTime(shift.starts_at, zone)} - ${clockTime(shift.ends_at, zone)}`
        : `until ${clockTime(shift.ends_at, zone)}`,
    ],
    [
      "short",
      startsHere
        ? `${compactTime(shift.starts_at, zone)}-${compactTime(shift.ends_at, zone)}`
        : `until ${compactTime(shift.ends_at, zone)}`,
    ],
  ].map(([length, text]) =>
    el("span", {
      className: `calendar-shift__time calendar-shift__time--${length}`,
      text,
      attrs: { "aria-hidden": "true" },
    }),
  );

  // The second line: the time, then the markers in a group of their own. The time
  // matters most, so it never shrinks for them: when the line is too narrow for both, the
  // markers move down to a line of their own (css/components/week-calendar.css).
  const when = el("span", { className: "calendar-shift__when" }, lengths);
  const markers = el("span", { className: "calendar-shift__markers" });
  // "+1" on the evening piece of a night shift, like the "+1 day" marker on the other
  // screens (shortened, since a block can be narrow).
  const days = daysLater(shift.starts_at, shift.ends_at, zone);
  if (startsHere && days >= 1) {
    markers.append(
      el("span", {
        className: "calendar-shift__next-day",
        text: `+${days}`,
        attrs: { "aria-hidden": "true" },
      }),
    );
  }
  // Icons only: a block can be narrow. The words ("Event", "Notes") stay for screen
  // readers.
  const extras = shiftExtras(shift, { compact: true });
  if (extras) markers.append(extras);
  if (markers.childElementCount) when.append(markers);
  return [name, when];
}

/**
 * One block: one piece of one shift, placed in its day column by its start, length, and
 * column. The block (an <li>) does the placing; inside it is the button with the name and
 * time, so edit mode can put a select box next to the button without moving anything.
 * @param {Shift} shift
 * @param {WeekSpan} span the whole shift's place in the week
 * @param {DayPiece} piece this piece
 * @param {{ column: number, columns: number }} place its column, and how many share the day
 * @param {HTMLElement | null} opener the shift's first piece (its real button), for the
 *   echo pieces; null for the first piece itself
 * @returns {{ block: HTMLElement, button: HTMLElement }}
 */
function calendarBlock(shift, span, piece, place, opener) {
  const employeeId = shift.employee?.id ?? "";
  const tooltip = `${shift.employee?.display_name ?? ""}, ${fullTime(shift, span)}`;

  /** @type {HTMLElement} */
  let button;
  if (!opener) {
    // The first piece: a real button, with the description screen readers hear. It opens
    // the details popup and carries data-shift-id, so edit mode gives it a select box.
    button = el(
      "button",
      { className: "calendar-shift", attrs: { type: "button", title: tooltip } },
      [...blockLabel(shift, piece), blockDescription(shift, span)],
    );
    opensShift(button, shift);
  } else {
    // An echo (the morning piece of a night shift): not a button and not in the Tab order,
    // since the shift is already there once. A click still opens the details, and focus
    // returns to the real button when the popup closes.
    const real = opener;
    button = el("div", { className: "calendar-shift", attrs: { title: tooltip } }, [
      ...blockLabel(shift, piece),
    ]);
    button.addEventListener("click", () => openShiftDialog(shift, real));
  }

  // The classes: the person's colour (from their ID, never from text), and a dashed, square
  // edge where the shift continues past this piece (css/components/week-calendar.css).
  const classes = ["week-calendar__block", personColourClass(employeeId)];
  if (piece.continued) classes.push("week-calendar__block--continued");
  if (piece.continues) classes.push("week-calendar__block--continues");
  const block = el(
    "li",
    {
      className: classes.join(" "),
      attrs: {
        // Who works it, so a later filter (the people menu, #83) can find a person's
        // blocks. The server's ID only, never a name.
        "data-person": employeeId,
        "data-shift": shift.id,
      },
    },
    [button],
  );
  // Screen readers skip the echo: they hear the whole shift on its first day.
  if (opener) block.setAttribute("aria-hidden", "true");

  // The placing, through the CSSOM (see the top of this file): plain numbers only, as
  // percentages of the day and a column out of a count, never text from a user.
  block.style.setProperty("--block-start", String((piece.start / DAY_MINUTES) * 100));
  block.style.setProperty(
    "--block-length",
    String(((piece.end - piece.start) / DAY_MINUTES) * 100),
  );
  block.style.setProperty("--block-column", String(place.column));
  block.style.setProperty("--block-columns", String(place.columns));
  return { block, button };
}

/**
 * The header of a day: "MON" over "5", and the full date for screen readers is on the
 * day's column instead (dayColumn), so this is only a picture.
 * @param {string} key "YYYY-MM-DD"
 * @param {boolean} isToday
 * @returns {HTMLElement}
 */
function dayHeader(key, isToday) {
  return el(
    "div",
    {
      className: isToday
        ? "week-calendar__day-head week-calendar__day-head--today"
        : "week-calendar__day-head",
      attrs: { "aria-hidden": "true", "data-day": key },
    },
    [
      el("span", { className: "week-calendar__weekday", text: formatWeekdayShort(key) }),
      el("span", { className: "week-calendar__number", text: formatDayNumber(key) }),
    ],
  );
}

/**
 * The hour labels down the left side, "12 AM" to "11 PM", each at the top of its hour.
 * Only a picture (each block's description already says its times), so screen readers
 * skip them.
 * @returns {HTMLElement}
 */
function hourLabels() {
  return el(
    "div",
    { className: "week-calendar__hours", attrs: { "aria-hidden": "true" } },
    Array.from({ length: 24 }, (_, hour) =>
      el("span", { className: "week-calendar__hour", text: hourLabel(hour) }),
    ),
  );
}

/**
 * One day's column: a list of its blocks, labelled with the full date ("Monday, October 5
 * (today)"), drawn over the hour lines.
 * @param {string} key "YYYY-MM-DD"
 * @param {boolean} isToday
 * @param {HTMLElement[]} blocks the day's blocks, in time order
 * @returns {HTMLElement}
 */
function dayColumn(key, isToday, blocks) {
  return el(
    "ul",
    {
      className: isToday ? "week-calendar__day week-calendar__day--today" : "week-calendar__day",
      attrs: {
        "aria-label": `${formatDayHeading(key)}${isToday ? " (today)" : ""}`,
        "data-day": key,
      },
    },
    blocks,
  );
}

/**
 * Where the time now falls in the week shown: which day (0 is Monday) and how far down
 * that day, as a percentage (0 is midnight at the top, 100 midnight at the bottom). Null
 * when now is not in this week (an earlier or later week is shown).
 *
 * It uses wall-clock time in the workplace zone, the same clock the blocks are placed on,
 * so the line crosses a 9:00 to 17:00 block at 12:00 exactly halfway down.
 * @param {string[]} keys the week's seven day keys, Monday first
 * @param {Date} now
 * @param {string} timeZone the workplace zone
 * @returns {{ day: number, percent: number } | null}
 */
export function nowPosition(keys, now, timeZone) {
  // 1. Today's day key in the workplace zone: is it one of the week's days?
  const moment = now.toISOString();
  const day = keys.indexOf(dayKey(moment, timeZone));
  if (day === -1) return null;
  // 2. The wall-clock time there, as minutes after midnight, then a share of the day.
  const [hour, minute] = wallTime(moment, timeZone).split(":").map(Number);
  return { day, percent: ((hour * 60 + minute) / DAY_MINUTES) * 100 };
}

/**
 * Draw the "now" line in the calendar, or move it to where now is. It goes into today's
 * column (moving to the next column at midnight) and disappears when now is not in the week
 * shown. Placed like the blocks: a custom property through the CSSOM (--now-at, a plain
 * number), never a style attribute.
 *
 * The line is a list item of its column, so the column's list stays valid HTML, but it is
 * hidden from screen readers (aria-hidden): it is a picture of the time, not a shift, and
 * would otherwise be counted as one ("list, 4 items").
 * @param {HTMLElement} calendar what weekCalendar returned
 * @param {Date} now
 * @param {string} timeZone the workplace zone
 */
export function placeNowLine(calendar, now, timeZone) {
  const columns = [...calendar.querySelectorAll(".week-calendar__day")];
  const keys = columns.map((column) => column.getAttribute("data-day") ?? "");
  const where = nowPosition(keys, now, timeZone);
  /** @type {HTMLElement | null} */
  let line = calendar.querySelector(".week-calendar__now");
  // Not this week: no line at all.
  if (!where) {
    line?.remove();
    return;
  }
  // The first time, make the line; after that, reuse it.
  if (!line) {
    line = el("li", { className: "week-calendar__now", attrs: { "aria-hidden": "true" } });
  }
  // In today's column (appending moves it there if it was in yesterday's), at the time.
  const column = columns[where.day];
  if (line.parentElement !== column) column.append(line);
  line.style.setProperty("--now-at", String(where.percent));
}

/**
 * Keep the "now" line where now is: placed at once, then moved every minute, while the
 * calendar is on the page. When the page shows another week or department it replaces the
 * calendar, and the old calendar's timer notices it is gone and stops.
 * @param {HTMLElement} calendar what weekCalendar returned, already on the page
 * @param {string} timeZone the workplace zone
 * @param {() => Date} [clock] where the time comes from (the tests pass their own)
 */
export function followNow(calendar, timeZone, clock = () => new Date()) {
  placeNowLine(calendar, clock(), timeZone);
  const timer = setInterval(() => {
    if (!calendar.isConnected) {
      clearInterval(timer);
      return;
    }
    placeNowLine(calendar, clock(), timeZone);
  }, 60 * 1000);
}

/**
 * The whole calendar for one week.
 * @param {string[]} keys the week's seven day keys, Monday first
 * @param {Shift[]} shifts the department's shifts that week (no cancelled ones); open ones
 *   are left out of the calendar
 * @param {{ today?: string }} [options] today (a day key) marks today's column
 * @returns {HTMLElement}
 */
export function weekCalendar(keys, shifts, options = {}) {
  // Step 1: the assigned shifts in time order (open shifts have their own section), each
  // cut into its pieces per day.
  const monday = keys[0];
  const assigned = shifts
    .filter((shift) => shift.employee)
    .map((shift) => ({ shift, span: weekSpan(shift, monday) }))
    .sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
  /** @type {{ shift: Shift, span: WeekSpan, piece: DayPiece }[][]} the pieces of each day */
  const byDay = keys.map(() => []);
  for (const { shift, span } of assigned) {
    for (const piece of dayPieces(span)) byDay[piece.day].push({ shift, span, piece });
  }

  // Step 2: each day's columns, then the blocks. A night shift's first piece is built
  // first (it is on an earlier day), so its morning piece can point back to it.
  /** @type {Map<string, HTMLElement>} each shift's real button, by shift ID */
  const firstButtons = new Map();
  const columns = keys.map((key, day) => {
    // In time order, longer first at the same start (so the long block gets the left
    // column, as in Google Calendar).
    const items = byDay[day].sort(
      (a, b) => a.piece.start - b.piece.start || b.piece.end - a.piece.end,
    );
    const place = assignColumns(items.map((item) => item.piece));
    const blocks = items.map(({ shift, span, piece }, index) => {
      const opener = piece.first ? null : (firstButtons.get(shift.id) ?? null);
      const { block, button } = calendarBlock(
        shift,
        span,
        piece,
        { column: place.columns[index], columns: place.counts[index] },
        opener,
      );
      if (piece.first) firstButtons.set(shift.id, button);
      return block;
    });
    return dayColumn(key, key === options.today, blocks);
  });

  // Step 3: the grid: the corner and the day headers, then the hour labels and the days.
  const grid = el("div", { className: "week-calendar__grid" }, [
    el("div", { className: "week-calendar__corner", attrs: { "aria-hidden": "true" } }),
    ...keys.map((key) => dayHeader(key, key === options.today)),
    hourLabels(),
    ...columns,
  ]);
  // The area that scrolls up and down, inside the card. It remembers where to open
  // (openAtFirstShift scrolls there once the calendar is on the page and has a size).
  const scroller = el(
    "div",
    {
      className: "week-calendar__scroll",
      attrs: {
        "data-first-hour": String(firstHour(byDay.flat().map((item) => item.piece))),
      },
    },
    [grid],
  );

  const calendar = el(
    "div",
    {
      className: "week-calendar",
      attrs: {
        role: "group",
        "aria-label":
          "Shifts this week: one list per day, each shift drawn from its start to its end",
      },
    },
    // A week without assigned shifts still shows its empty days, with a line that says so.
    assigned.length
      ? [scroller]
      : [
          el("p", { className: "week-calendar__empty", text: "Nobody is scheduled this week." }),
          scroller,
        ],
  );
  return calendar;
}

/**
 * Scroll the calendar so it opens at the week's earliest shift (or 6 AM), the way Google
 * Calendar opens at the start of the working day instead of at midnight. Call it once the
 * calendar is on the page: before that it has no size to scroll. On a phone the calendar
 * is hidden (the day cards show instead), has no size, and this waits until it gets one.
 * @param {HTMLElement} calendar what weekCalendar returned
 * @param {number} [framesLeft] where there is no ResizeObserver: how many more frames to
 *   wait for the calendar to get a size
 */
export function openAtFirstShift(calendar, framesLeft = 30) {
  const scroller = calendar.querySelector(".week-calendar__scroll");
  const day = calendar.querySelector(".week-calendar__day");
  if (!(scroller instanceof HTMLElement) || !(day instanceof HTMLElement)) return;
  // Ready to scroll: laid out with a height, and taller inside than its window (its
  // stylesheet has given it a fixed height and a scroll bar).
  const sized = () =>
    Boolean(
      day.offsetHeight && scroller.clientHeight && scroller.scrollHeight > scroller.clientHeight,
    );
  // Right after the calendar is put on the page, some browsers (WebKit) have not laid it
  // out yet, or not with its stylesheets: then it has no height, or it is as tall as the
  // whole day with nothing to scroll, and scrolling would leave it at midnight. How long
  // that takes depends on how busy the computer is, so there is no time limit: a
  // ResizeObserver says when the calendar's size changes, and it scrolls once it is ready.
  // It stops watching once the calendar is off the page (another week replaced it). A
  // hidden calendar (on a phone) is watched until it is shown or replaced, so turning a
  // tablet to landscape still opens it at the first shift.
  if (!sized()) {
    if (typeof ResizeObserver === "function") {
      const watcher = new ResizeObserver(() => {
        if (!calendar.isConnected) {
          watcher.disconnect();
        } else if (sized()) {
          watcher.disconnect();
          scrollToFirstShift(scroller, day);
        }
      });
      watcher.observe(scroller);
      watcher.observe(day);
      return;
    }
    // Without one (an old browser, or the unit tests' jsdom): try again at the next frame,
    // for up to about half a second (30 frames).
    if (framesLeft > 0 && calendar.isConnected) {
      requestAnimationFrame(() => openAtFirstShift(calendar, framesLeft - 1));
    }
    return;
  }
  scrollToFirstShift(scroller, day);
}

/**
 * Scroll a calendar that has its size to the hour it should open at.
 * @param {HTMLElement} scroller the calendar's scrolling area
 * @param {HTMLElement} day one day column (24 hours tall)
 */
function scrollToFirstShift(scroller, day) {
  const hour = Number(scroller.dataset.firstHour ?? DEFAULT_FIRST_HOUR);
  // One hour is a 24th of a day column. A little less than the full distance, so the
  // hour's label is not tucked under the pinned day headers.
  const hourHeight = day.offsetHeight / 24;
  scroller.scrollTop = Math.max(hour * hourHeight - hourHeight / 4, 0);
}

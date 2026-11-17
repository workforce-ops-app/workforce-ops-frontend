// The department week as a timeline, for managers planning on a laptop
// (workforce-ops-app/workforce-ops-frontend#53): one row per person, the week's seven days
// running across, and each shift drawn as a bar from its real start to its real end. A
// night shift from 10:00 PM to 6:00 AM is a bar that visibly crosses into the next day, so
// a manager sees at a glance how shifts line up, where the gaps are, and who works long
// stretches. Each person's hours are at the end of their row.
//
// Open shifts (nobody assigned yet) are not in the timeline: they get their own section
// below it (js/components/week-sections.js), so every row is a person.
// Used by the department week on wide screens; phones see the day cards instead.
//
// It is a real <table>, not a pile of <div>s: the header cells (<th scope="col"> for days,
// <th scope="row"> for people) let a screen reader move through it row by row and hear
// whose row it is in. Each row has one wide cell under all seven days (the "track"), and
// the bars are placed inside it by how far into the week they start.
//
// How a bar is placed, and why it is safe with our Content Security Policy:
// - The page's policy is style-src 'self', so style="..." attributes (and any HTML that
//   carries them) are refused by the browser. That stops an attacker who manages to inject
//   markup from restyling the page, for example to hide a warning.
// - So the script never writes a style attribute. It sets two CSS custom properties
//   through the DOM (element.style.setProperty, the CSSOM, which the policy allows because
//   only our own script can call it): --bar-start and --bar-length, as percentages of the
//   week. css/components/week-timeline.css turns them into left and width.
// - The numbers come from the shift's times, which the server sends; no text a user wrote
//   ever reaches a style.
//
// Positions use wall-clock time in the workplace zone, the same clock as the day columns:
// a shift from 9:00 to 17:00 always covers 9:00 to 17:00 of its day. On the night the
// clocks fall back, a 10:00 PM to 6:00 AM shift lasts 9 real hours but is drawn over the
// 8 hours of the clock face; its hours at the end of the row still count the real 9.
//
// One day is highlighted at a time: the day under the mouse (or holding keyboard focus),
// and today's when there is none, so the eye can follow a day down the timeline.
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
  hoursBetween,
  roundHours,
  wallTime,
} from "../core/time.js";
import { shiftExtras } from "./shift-card.js";
import { shiftTime } from "./shift-time.js";
import { opensShift } from "./shift-dialog.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */

/**
 * @typedef {{ key: string, label: string, shifts: Shift[] }} TimelineRow
 *   one row of the timeline: a person and their shifts that week
 */

/**
 * Where a shift sits in the week, in minutes from Monday 00:00 (wall-clock time).
 * @typedef {{
 *   start: number, end: number, startedBefore: boolean, continuesAfter: boolean,
 * }} BarSpan
 *   start and end are clamped to the week; the two flags say whether the shift really
 *   started before Monday or runs on past Sunday midnight
 */

/** Minutes in a day, and in the whole week the timeline shows. */
const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;

/** The class of the highlighted day's cells (header and day bands). */
const ACTIVE = "week-timeline__col--active";

/**
 * Sort a week's assigned shifts into rows: one per person, by name. Open shifts are left
 * out (they have their own section). Only people with a shift that week get a row, because
 * the shifts answer already carries their names; the people without one are listed below
 * the timeline.
 * @param {Shift[]} shifts
 * @returns {TimelineRow[]}
 */
export function timelineRows(shifts) {
  /** @type {Map<string, TimelineRow>} */
  const rows = new Map();
  for (const shift of shifts) {
    // An open shift has no employee: skip it.
    if (!shift.employee) continue;
    // The person's row, or a new one the first time we meet them.
    const row = rows.get(shift.employee.id) ?? {
      key: shift.employee.id,
      label: shift.employee.display_name,
      shifts: [],
    };
    row.shifts.push(shift);
    rows.set(row.key, row);
  }
  // By name, so the rows are in the same order every week.
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
}

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
 * Where a shift's bar goes in the week, clamped to the week the timeline shows.
 * @param {Shift} shift
 * @param {string} monday the week's Monday, "YYYY-MM-DD"
 * @returns {BarSpan}
 */
export function barSpan(shift, monday) {
  const rawStart = minutesIntoWeek(shift.starts_at, shift.timezone, monday);
  const rawEnd = minutesIntoWeek(shift.ends_at, shift.timezone, monday);
  // A Sunday night shift runs past the end of the week, and a shift from the Sunday
  // before could reach into Monday morning: draw only the part inside this week and keep
  // a note of the rest, so the bar can say it continues.
  const start = Math.max(rawStart, 0);
  // At least one minute long, so a bar never vanishes. (The server refuses shifts without
  // a length, but on the night the clocks spring forward the wall clock jumps, so 2:00 to
  // 3:00 can read as no time at all.)
  const end = Math.max(Math.min(rawEnd, WEEK_MINUTES), start + 1);
  return { start, end, startedBefore: rawStart < 0, continuesAfter: rawEnd > WEEK_MINUTES };
}

/**
 * Give each bar of a row a lane (a line within the row), so bars that overlap in time sit
 * one above the other instead of on top of each other. One person cannot have two shifts
 * at the same time (the server refuses double booking), so a person's row normally needs
 * a single lane; this keeps the timeline readable even if old data breaks that rule.
 * @param {BarSpan[]} spans in the same order as the bars
 * @returns {{ lanes: number[], count: number }} each bar's lane (0 is the top) and how
 *   many lanes the row needs
 */
export function assignLanes(spans) {
  // Step 1: look at the bars from the earliest start to the latest.
  const order = spans.map((_, index) => index).sort((a, b) => spans[a].start - spans[b].start);
  /** @type {number[]} where each lane is free again (the end of its last bar) */
  const laneEnds = [];
  /** @type {number[]} */
  const lanes = new Array(spans.length).fill(0);
  for (const index of order) {
    // Step 2: the first lane whose last bar has ended by the time this one starts.
    let lane = laneEnds.findIndex((end) => end <= spans[index].start);
    // Step 3: none is free, so open a new lane below the others.
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = spans[index].end;
    lanes[index] = lane;
  }
  return { lanes, count: Math.max(laneEnds.length, 1) };
}

/**
 * What a screen reader hears for a bar: "Ana Diaz, Monday, October 5, 10:00 PM - 6:00 AM
 * (ends the next day)". The visible label is only "10p-6a", which says nothing without the
 * row and the position around it.
 * @param {Shift} shift
 * @param {string} person the row's name
 * @param {BarSpan} span
 * @returns {HTMLElement}
 */
function barDescription(shift, person, span) {
  const day = formatDayHeading(dayKey(shift.starts_at, shift.timezone));
  const description = el("span", { className: "visually-hidden" }, [
    `${person}, ${day}, `,
    // The same full time as every other screen, with its own "(ends the next day)".
    shiftTime(shift, "week-timeline__full-time"),
  ]);
  // Said in words, since a cut-off edge is only a picture.
  if (span.startedBefore) description.append(" (started the week before)");
  if (span.continuesAfter) description.append(" (continues into next week)");
  return description;
}

/**
 * What sighted people see on a bar: its time, all on one line, in three lengths. The
 * stylesheet shows the one that fits the bar's own width (a container query on the bar,
 * css/components/week-timeline.css), so a short shift never wraps its time over two lines
 * or cuts it off halfway:
 *   full    "9 AM - 5 PM"   wide bars (a long shift, or a wide screen)
 *   short   "9a-5p"         most bars on a laptop
 *   start   "9a"            the narrowest bars (a short shift on a small screen)
 * After the time come the markers, shown when there is room: "+1" when the shift ends the
 * next day, and the event and notes icons. Whatever the bar shows, the whole time is in
 * its tooltip (timelineBar), its screen reader description, and the details popup.
 *
 * The times and "+1" are hidden from screen readers, which hear the full description
 * instead (otherwise they would hear the time two or three times). The icons keep their
 * words ("Event", "Notes") for screen readers.
 * @param {Shift} shift
 * @returns {HTMLElement[]}
 */
function barLabel(shift) {
  const zone = shift.timezone;
  // The three lengths, each its own element; the stylesheet shows exactly one.
  const lengths = [
    ["full", `${clockTime(shift.starts_at, zone)} - ${clockTime(shift.ends_at, zone)}`],
    ["short", `${compactTime(shift.starts_at, zone)}-${compactTime(shift.ends_at, zone)}`],
    ["start", compactTime(shift.starts_at, zone)],
  ].map(([length, text]) =>
    el("span", {
      className: `timeline-shift__time timeline-shift__time--${length}`,
      text,
      attrs: { "aria-hidden": "true" },
    }),
  );
  // The markers go in a group of their own after the time. The time matters most, so it
  // never shrinks for them: when space runs out, the markers are the part cut off at the
  // bar's edge (and on narrow bars the stylesheet hides them altogether).
  const markers = el("span", { className: "timeline-shift__markers" });

  // An overnight shift also says so on screen, not only by crossing the day line: a small
  // "+1" after the time, like the "+1 day" marker on the other screens (shortened, since a
  // bar is narrow).
  const days = daysLater(shift.starts_at, shift.ends_at, zone);
  if (days >= 1) {
    markers.append(
      el("span", {
        className: "timeline-shift__next-day",
        text: `+${days}`,
        attrs: { "aria-hidden": "true" },
      }),
    );
  }
  // Icons only: a bar is narrow. The words ("Event", "Notes") stay for screen readers.
  const extras = shiftExtras(shift, { compact: true });
  if (extras) markers.append(extras);
  return markers.childElementCount ? [...lengths, markers] : lengths;
}

/**
 * One shift on the timeline: a bar placed by its start and length, holding a button with
 * its short time and icons for an event or notes. The row already says who works it;
 * clicking opens everything else (role, event, notes) in the details popup.
 *
 * The bar (a <div>) and the button are separate on purpose: the bar does the placing, so
 * edit mode can put a select box with the button inside it without moving anything.
 * @param {Shift} shift
 * @param {string} person the row's name
 * @param {BarSpan} span where it goes
 * @param {number} lane which line of the row it sits on
 * @returns {HTMLElement}
 */
function timelineBar(shift, person, span, lane) {
  // The tooltip: the whole time ("10 PM - 6 AM (ends the next day)") for anyone pointing
  // at a bar too narrow to show it. Plain text in an attribute, never markup.
  const tooltip = `${clockTime(shift.starts_at, shift.timezone)} - ${clockTime(shift.ends_at, shift.timezone)}${
    daysLater(shift.starts_at, shift.ends_at, shift.timezone) >= 1 ? " (ends the next day)" : ""
  }`;
  const button = el(
    "button",
    { className: "timeline-shift", attrs: { type: "button", title: tooltip } },
    [...barLabel(shift), barDescription(shift, person, span)],
  );
  opensShift(button, shift);

  // The classes draw a cut-off edge where the shift continues outside this week, and a
  // marker where it crosses midnight (css/components/week-timeline.css).
  const classes = ["week-timeline__bar"];
  if (span.startedBefore) classes.push("week-timeline__bar--started-before");
  if (span.continuesAfter) classes.push("week-timeline__bar--continues");
  const bar = el(
    "div",
    {
      className: classes.join(" "),
      // The day it starts on, so pointing at the bar highlights that day.
      attrs: { "data-day": dayKey(shift.starts_at, shift.timezone) },
    },
    [button],
  );

  // The placing, through the CSSOM (see the top of this file): plain numbers, as
  // percentages of the week and a lane number, never text from a user.
  bar.style.setProperty("--bar-start", String((span.start / WEEK_MINUTES) * 100));
  bar.style.setProperty("--bar-length", String(((span.end - span.start) / WEEK_MINUTES) * 100));
  bar.style.setProperty("--bar-lane", String(lane));
  return bar;
}

/**
 * The hour labels of one day header: "6a", "12p", and "6p", a quarter, a half, and three
 * quarters of the way across the day, where the day bands draw their faint lines. Only a
 * picture (each bar's description already says its times), so screen readers skip them.
 * @returns {HTMLElement}
 */
function hourTicks() {
  return el(
    "span",
    { className: "week-timeline__ticks", attrs: { "aria-hidden": "true" } },
    // The modifier says which line each label sits over; the CSS turns it into a place.
    [
      ["6a", "morning"],
      ["12p", "noon"],
      ["6p", "evening"],
    ].map(([text, when]) =>
      el("span", { className: `week-timeline__tick week-timeline__tick--${when}`, text }),
    ),
  );
}

/**
 * The header cell of a day: "MON" over "5" with hour labels under them, and the full date
 * for screen readers.
 * @param {string} key "YYYY-MM-DD"
 * @param {boolean} isToday
 * @returns {HTMLElement}
 */
function dayHeader(key, isToday) {
  return el(
    "th",
    {
      className: isToday ? "week-timeline__day week-timeline__day--today" : "week-timeline__day",
      // data-day names the column, for the highlight below.
      attrs: { scope: "col", "data-day": key },
    },
    [
      // What sighted people see: a small weekday over a large date, like the day cards.
      el("span", {
        className: "week-timeline__weekday",
        text: formatWeekdayShort(key),
        attrs: { "aria-hidden": "true" },
      }),
      el("span", {
        className: "week-timeline__number",
        text: formatDayNumber(key),
        attrs: { "aria-hidden": "true" },
      }),
      // Small hour labels along the bottom of the header, each over the faint line it
      // names in the day bands below (week-timeline.css places them).
      hourTicks(),
      // What screen readers hear instead: "Monday, October 5 (today)".
      el("span", {
        className: "visually-hidden",
        text: `${formatDayHeading(key)}${isToday ? " (today)" : ""}`,
      }),
    ],
  );
}

/**
 * The seven day bands behind a row's bars: they draw the lines between days and the
 * faint lines at 6 AM, noon, and 6 PM, and carry the day highlight down the timeline.
 * Only a picture, so screen readers skip them.
 * @param {string[]} keys the week's day keys
 * @returns {HTMLElement}
 */
function dayBands(keys) {
  return el(
    "div",
    { className: "week-timeline__bands", attrs: { "aria-hidden": "true" } },
    keys.map((key) => el("div", { className: "week-timeline__band", attrs: { "data-day": key } })),
  );
}

/**
 * Highlight one day, header and bands included, and no other.
 * @param {HTMLElement} table
 * @param {string | undefined} key the day to highlight; undefined highlights none
 */
export function highlightDay(table, key) {
  // Bars carry data-day too (for the pointer, below); they never get the class, so only
  // the header and the bands change colour.
  for (const cell of table.querySelectorAll("th[data-day], .week-timeline__band")) {
    cell.classList.toggle(ACTIVE, cell instanceof HTMLElement && cell.dataset.day === key);
  }
}

/**
 * Make the highlight follow the mouse and keyboard focus, and fall back to today.
 * The highlight is only a visual aid: a screen reader already hears each bar's day in its
 * description, so nothing here changes what it reads.
 * @param {HTMLElement} table
 * @param {string | undefined} today
 */
function followPointer(table, today) {
  // The day of the band, header, or bar an event happened in, or today outside them (the
  // names and hours columns).
  const dayOf = (/** @type {Event} */ event) => {
    const target = event.target instanceof Element ? event.target : null;
    const cell = target?.closest("[data-day]");
    return cell instanceof HTMLElement ? cell.dataset.day : today;
  };

  table.addEventListener("pointerover", (event) => highlightDay(table, dayOf(event)));
  table.addEventListener("pointerleave", () => highlightDay(table, today));
  table.addEventListener("focusin", (event) => highlightDay(table, dayOf(event)));
  table.addEventListener("focusout", (event) => {
    // Only when focus leaves the timeline; moving between shifts is handled by focusin.
    if (!(event.relatedTarget instanceof Node && table.contains(event.relatedTarget))) {
      highlightDay(table, today);
    }
  });
}

/**
 * One person's row: their name, a track with their bars over the seven days, and their
 * hours for the week.
 * @param {TimelineRow} row
 * @param {string[]} keys the week's day keys, Monday first
 * @returns {HTMLElement}
 */
function personRow(row, keys) {
  // Step 1: where each of the person's shifts goes, and on which lane.
  const spans = row.shifts.map((shift) => barSpan(shift, keys[0]));
  const { lanes, count } = assignLanes(spans);

  // Step 2: the track, one cell under all seven days, with the day bands behind the bars.
  const track = el("td", { className: "week-timeline__track", attrs: { colspan: "7" } }, [
    dayBands(keys),
    ...row.shifts.map((shift, index) => timelineBar(shift, row.label, spans[index], lanes[index])),
  ]);
  // A row with overlapping bars grows to fit its lanes (normally just one).
  track.style.setProperty("--bar-lanes", String(count));
  // A row without shifts never gets here: only people with a shift have a row.

  // Step 3: the hours, real time between start and end, so an overnight shift counts its
  // full length, and so does a night when the clocks change.
  const hours = row.shifts.reduce((sum, s) => sum + hoursBetween(s.starts_at, s.ends_at), 0);

  return el("tr", {}, [
    el("th", { className: "week-timeline__person", text: row.label, attrs: { scope: "row" } }),
    track,
    el("td", { className: "week-timeline__hours", text: roundHours(hours) }),
  ]);
}

/**
 * The whole timeline for one week.
 * @param {string[]} keys the week's seven day keys, Monday first
 * @param {Shift[]} shifts the department's shifts that week (no cancelled ones); open ones
 *   are left out of the timeline
 * @param {{ today?: string }} [options] today (a day key) marks today's column
 * @returns {HTMLElement}
 */
export function weekTimeline(keys, shifts, options = {}) {
  // The header: "Person", the seven days, "Hours".
  const header = el("tr", {}, [
    el("th", { className: "week-timeline__corner", text: "Person", attrs: { scope: "col" } }),
    ...keys.map((key) => dayHeader(key, key === options.today)),
    el("th", { className: "week-timeline__hours", text: "Hours", attrs: { scope: "col" } }),
  ]);

  // A row per person, or one line that says so when nobody has a shift this week.
  const rows = timelineRows(shifts).map((row) => personRow(row, keys));
  const body = rows.length
    ? rows
    : [
        el("tr", {}, [
          el("td", {
            className: "week-timeline__empty",
            text: "Nobody is scheduled this week.",
            attrs: { colspan: String(keys.length + 2) },
          }),
        ]),
      ];

  const table = el("table", { className: "week-timeline" }, [
    el("caption", {
      className: "visually-hidden",
      text: "Shifts this week: one row per person, each shift drawn from its start to its end across the days",
    }),
    el("thead", {}, [header]),
    el("tbody", {}, body),
  ]);

  // Today's column starts highlighted; the mouse and keyboard move the highlight.
  highlightDay(table, options.today);
  followPointer(table, options.today);
  return table;
}

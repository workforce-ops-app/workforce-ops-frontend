// Department week: everyone's shifts for one week, with open shifts highlighted
// (frontend docs, features/schedules.md). It is laid out for planning: tiles with the
// week's numbers at the top, then, on a laptop, a grid with one row per person and one
// column per day (js/components/week-grid.js). Phones see a card per day instead
// (js/components/day-list.js); css/pages/schedule.css shows one or the other.
//
// The address says which week and department to show, so a week can be bookmarked or
// shared: schedule.html?week=2026-10-05&department=<id>. Without a week it shows the
// current one. Without a department it shows the person's own (home) department, so
// shifts of different departments are never mixed on one page; someone without a home
// department sees the first department of the company.

import { ApiError, NetworkError } from "../api/client.js";
import { listDepartments, listShifts, myDepartmentId } from "../api/shifts.js";
import { dayCard, groupByDay } from "../components/day-list.js";
import { statTile } from "../components/stat-tile.js";
import { weekGrid } from "../components/week-grid.js";
import { el, setText } from "../core/dom.js";
import { addDays, formatWeekRange, hoursBetween, roundHours } from "../core/time.js";
import { requestedMonday, today, weekLink } from "../core/week.js";

/** The heading when the department's name is not known (e.g. an ID from an old link). */
const DEFAULT_TITLE = "Department week";

/**
 * The week's numbers for the tiles: shifts, open shifts, hours worked, and people working.
 * @param {import("../api/shifts.js").Shift[]} shifts the week's shifts (no cancelled ones)
 * @returns {HTMLElement[]}
 */
export function weekStats(shifts) {
  const open = shifts.filter((s) => !s.employee).length;
  const assigned = shifts.filter((s) => s.employee);
  const hours = assigned.reduce((sum, s) => sum + hoursBetween(s.starts_at, s.ends_at), 0);
  const people = new Set(assigned.map((s) => s.employee?.id)).size;
  return [
    statTile("Shifts", shifts.length),
    statTile("Open shifts", open, { attention: open > 0 }),
    statTile("Hours scheduled", roundHours(hours)),
    statTile("People working", people),
  ];
}

/**
 * Load one department's week and show it, with links to the weeks before and after.
 * Exported for the tests; the page calls it once when it loads (below).
 * @param {string} search the address's query string, e.g. "?week=2026-10-05"
 */
export async function showWeek(search) {
  const title = document.getElementById("title");
  const range = document.getElementById("week-range");
  const previous = document.getElementById("previous-week");
  const next = document.getElementById("next-week");
  const status = document.getElementById("status");
  const week = document.getElementById("days");
  if (!title || !range || !previous || !next || !status || !week) return;
  // The tiles and the grid are optional, so a page (or a test) without them still works.
  const stats = document.getElementById("stats");
  const grid = document.getElementById("grid");

  // Everything that reads the address or the server is inside try, so a bad address or a
  // failed request shows a message instead of leaving the page on "Loading".
  try {
    // Which week, from the address (an impossible ?week= falls back to the current week),
    // and the links to other weeks (they keep the department).
    const params = new URLSearchParams(search);
    const todayKey = today();
    const monday = requestedMonday(params, todayKey);
    setText(range, formatWeekRange(monday));
    previous.setAttribute("href", weekLink(monday, -1, params));
    next.setAttribute("href", weekLink(monday, 1, params));

    // Which department: the one in the address, else the person's own, else the first one.
    // The address is only a choice of what to look at: the API still checks that the
    // person may see that department (an ID from another company answers 404).
    const departments = await listDepartments();
    const departmentId =
      params.get("department") ?? (await myDepartmentId()) ?? departments[0]?.id ?? null;

    // Name the department in the heading from the departments list, not from the shifts,
    // so a week with no shifts is still named.
    const department = departments.find((d) => d.id === departmentId);
    setText(title, department?.name ?? DEFAULT_TITLE);

    // No department at all (a company without departments yet): nothing to show.
    if (!departmentId) {
      setText(status, "No departments yet.");
      week.replaceChildren();
      grid?.replaceChildren();
      if (stats) stats.hidden = true;
      return;
    }

    // The seven days of the week, Monday to Sunday, for that one department.
    const shifts = await listShifts({ from: monday, to: addDays(monday, 6), departmentId });

    // A card for all seven days, even empty ones, with who works each shift.
    setText(status, "");
    const grouped = groupByDay(shifts);
    const keys = Array.from({ length: 7 }, (_, offset) => addDays(monday, offset));
    week.replaceChildren(
      ...keys.map((key) =>
        dayCard(key, grouped.get(key) ?? [], { showEmployee: true, today: todayKey }),
      ),
    );

    // The same shifts as a grid, for wide screens.
    grid?.replaceChildren(weekGrid(keys, shifts, { today: todayKey }));

    // The week's numbers at the top.
    if (stats) {
      stats.replaceChildren(...weekStats(shifts));
      stats.hidden = false;
    }
  } catch (error) {
    // The two failures a page expects get a plain-language message; the tiles would only
    // show stale or empty numbers, so they are hidden.
    if (stats) stats.hidden = true;
    if (error instanceof ApiError || error instanceof NetworkError) {
      const message = error instanceof ApiError ? error.title : "the server could not be reached";
      status.replaceChildren(el("span", { className: "error", text: `Problem: ${message}` }));
      return;
    }
    // Anything else is a bug in our own code: say something went wrong, and throw it on.
    status.replaceChildren(
      el("span", { className: "error", text: "Problem: this page could not load" }),
    );
    throw error;
  }
}

// Show the week the address asks for, once when the page opens.
showWeek(window.location.search);

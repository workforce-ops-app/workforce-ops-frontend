// Department week: everyone's shifts for one week, with open shifts highlighted
// (frontend docs, features/schedules.md). It is laid out for planning: tiles with the
// week's numbers at the top, then, on a laptop, a grid with one row per person and one
// column per day (js/components/week-grid.js), with the open shifts in their own section
// under it. Phones see a card per day instead, open shifts included
// (js/components/day-list.js); css/pages/schedule.css shows one or the other. Last comes
// the list of the department's people without a shift that week
// (js/components/week-sections.js), for people allowed to list them.
//
// The address says which week and department to show, so a week can be bookmarked or
// shared: schedule.html?week=2026-10-05&department=<id>. Without a week it shows the
// current one. Without a department it shows the person's own (home) department, from the
// loaded session, so shifts of different departments are never mixed on one page; if the
// session names none, it shows the first department of the company.

import { ApiError, NetworkError } from "../api/client.js";
import { listDepartmentPeople, listDepartments, listShifts } from "../api/shifts.js";
import { startSignedInPage } from "../components/app-shell.js";
import { dayCard, groupByDay } from "../components/day-list.js";
import { statTile } from "../components/stat-tile.js";
import { weekGrid } from "../components/week-grid.js";
import { weekEditor } from "../components/week-editor.js";
import { followWeekLinks } from "../components/week-nav.js";
import { openShiftsSection, unscheduledSection } from "../components/week-sections.js";
import { el, setText } from "../core/dom.js";
import { can, currentSession } from "../core/session.js";
import { addDays, formatWeekRange, hoursBetween, roundHours } from "../core/time.js";
import { requestedMonday, today, weekLink } from "../core/week.js";

/** The heading when the department's name is not known (e.g. an ID from an old link). */
const DEFAULT_TITLE = "Department week";

/** What the page says about a department it cannot show (#47). The same words for every
 * reason, so they never reveal whether the department exists in another company. */
export const UNAVAILABLE =
  "This department is unavailable. It may not exist, or you may not have access to it.";

/**
 * Say that the department cannot be shown and, when the address chose it, offer a way
 * back to the person's own department (the same week, without the department).
 * @param {HTMLElement} status
 * @param {URLSearchParams} params the address's parameters
 * @param {string} monday the week shown, "YYYY-MM-DD"
 */
function showUnavailable(status, params, monday) {
  const message = el("span", { className: "error", text: UNAVAILABLE });
  if (!params.has("department")) {
    // The person's own department is the missing one: there is nowhere better to send them.
    status.replaceChildren(message);
    return;
  }
  // weekLink builds the address with URLSearchParams, so the link can only ever carry a
  // week and the remaining settings, never a script or another site.
  const others = new URLSearchParams(params);
  others.delete("department");
  status.replaceChildren(
    message,
    " ",
    el("a", { text: "Show my department", attrs: { href: weekLink(monday, 0, others) } }),
  );
}

/**
 * Edit mode (js/components/week-editor.js), set up once the session has loaded; null
 * before that, and in the tests that call showWeek directly.
 * @type {{ update: (context: import("../components/week-editor.js").WeekContext | null) => void } | null}
 */
let editor = null;

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
 * The department's people, or null when the page should leave out the "Unscheduled
 * employees" section: seeing the week's shifts does not need the right to list people.
 * - Without user.view in the session, nothing is asked at all (no request bound to fail).
 * - 403: the server says no after all (for example, user.view in another department only).
 * - 404: the people endpoint does not exist yet (backend #54, after the midterm).
 * Any other failure is a real problem and is thrown on, like a failed shifts request.
 * @param {string} departmentId
 * @returns {Promise<import("../api/shifts.js").EmployeeRef[] | null>}
 */
async function peopleOrNull(departmentId) {
  if (!can("user.view")) return null;
  try {
    return await listDepartmentPeople(departmentId);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

/**
 * Load one department's week and show it, with links to the weeks before and after.
 * Exported for the tests; the page calls it when it loads and for each week chosen with
 * Previous, Next, Back, or Forward (below).
 * @param {string} search the address's query string, e.g. "?week=2026-10-05"
 */
export async function showWeek(search) {
  const title = document.getElementById("title");
  const range = document.getElementById("week-range");
  const previous = document.getElementById("previous-week");
  const current = document.getElementById("current-week");
  const next = document.getElementById("next-week");
  const status = document.getElementById("status");
  const week = document.getElementById("days");
  if (!title || !range || !previous || !current || !next || !status || !week) return;
  // The tiles, the grid, and the sections are optional, so a page (or a test) without
  // them still works.
  const stats = document.getElementById("stats");
  const grid = document.getElementById("grid");
  const sections = document.getElementById("sections");

  // Everything that reads the address or the server is inside try, so a bad address or a
  // failed request shows a message instead of leaving the page on "Loading".
  try {
    // While a week loads, edit mode has no week to change: its buttons wait (and stay off
    // if this week cannot be shown).
    editor?.update(null);

    // Which week, from the address (an impossible ?week= falls back to the current week),
    // and the links to other weeks (they keep the department).
    const params = new URLSearchParams(search);
    const todayKey = today();
    const monday = requestedMonday(params, todayKey);
    const currentMonday = requestedMonday(new URLSearchParams(), todayKey);
    setText(range, formatWeekRange(monday));
    previous.setAttribute("href", weekLink(monday, -1, params));
    if (monday === currentMonday) {
      current.removeAttribute("href");
      current.setAttribute("aria-disabled", "true");
    } else {
      current.setAttribute("href", weekLink(currentMonday, 0, params));
      current.removeAttribute("aria-disabled");
    }
    next.setAttribute("href", weekLink(monday, 1, params));

    // Which department: the one in the address, else the person's own (from the session
    // the page already loaded, so no second "who am I?" request), else the first one.
    // The address is only a choice of what to look at: the API still filters every shift
    // to what the person may see (another company's department simply has none).
    const departments = await listDepartments();
    const departmentId =
      params.get("department") ??
      currentSession()?.user.department_id ??
      departments[0]?.id ??
      null;

    // Name the department in the heading from the departments list, not from the shifts,
    // so a week with no shifts is still named.
    const department = departments.find((d) => d.id === departmentId);
    setText(title, department?.name ?? DEFAULT_TITLE);

    // No department at all (a company without departments yet): nothing to show.
    if (!departmentId) {
      setText(status, "No departments yet.");
      week.replaceChildren();
      grid?.replaceChildren();
      sections?.replaceChildren();
      if (stats) stats.hidden = true;
      return;
    }

    // A department that is not in the company's list (#47): an ID of another company, a
    // department that no longer exists, or a mistyped address. Without this check the page
    // would ask for its shifts, get an empty list (the server filters out everything the
    // person may not see), and say "Nobody is scheduled this week", which looks like a
    // real, empty department. Instead the page says it cannot show it.
    //
    // All three cases get the same words on purpose. Saying "this belongs to another
    // company" would confirm that the ID exists somewhere, which is exactly what company
    // isolation must not reveal (threat model: cross-company access). The departments
    // list only ever holds the person's own company, so nothing here can leak another
    // company's names either.
    if (!department) {
      showUnavailable(status, params, monday);
      week.replaceChildren();
      grid?.replaceChildren();
      sections?.replaceChildren();
      if (stats) stats.hidden = true;
      return;
    }

    // The seven days of the week, Monday to Sunday, for that one department, and its
    // people (for the unscheduled list). The two requests do not depend on each other,
    // so they run at the same time.
    const [shifts, people] = await Promise.all([
      listShifts({ from: monday, to: addDays(monday, 6), departmentId }),
      sections ? peopleOrNull(departmentId) : null,
    ]);

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

    // Under it, the open shifts (wide screens; phones have them in the day cards) and the
    // people without a shift, when the person may see the department's people.
    sections?.replaceChildren(
      openShiftsSection(shifts),
      ...(people ? [unscheduledSection(people, shifts)] : []),
    );

    // The week's numbers at the top.
    if (stats) {
      stats.replaceChildren(...weekStats(shifts));
      stats.hidden = false;
    }

    // Edit mode works on exactly this week and department.
    editor?.update({ departmentId, monday, days: keys, shifts, people, today: todayKey });
  } catch (error) {
    // The two failures a page expects get a plain-language message. Whatever week is still
    // on screen (the one before, when moving between weeks) is not this week's, so the
    // tiles, the grid, the day cards, and the sections all go.
    if (stats) stats.hidden = true;
    week.replaceChildren();
    grid?.replaceChildren();
    sections?.replaceChildren();
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

// Once the session has loaded (signed-out visitors go to the sign-in page instead), show
// the week the address asks for. Other weeks then load in place (components/week-nav.js).
startSignedInPage(() => {
  const load = followWeekLinks(showWeek);
  // After a saved change, edit mode loads the week again through the same queue as the
  // week links, so a reload and a week change never race each other.
  editor = weekEditor({ reload: () => load(window.location.search) });
  return showWeek(window.location.search);
});

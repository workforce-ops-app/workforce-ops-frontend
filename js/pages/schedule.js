// Department week: one department's shifts for a week, Monday to Sunday, with open shifts
// highlighted (frontend docs, features/schedules.md). A day-by-day list on phones and a
// seven-column grid on wider screens (css/pages/schedule.css).
//
// The address says which week and department to show, so a week can be bookmarked or
// shared: schedule.html?week=2026-10-05&department=<id>. Without a week it shows the
// current one; without a department, every department the person may see (the API
// limits that to their scope).

import { ApiError, NetworkError } from "../api/client.js";
import { listShifts } from "../api/shifts.js";
import { daySection, groupByDay } from "../components/day-list.js";
import { el, setText } from "../core/dom.js";
import { addDays, dayKey, formatDayHeading, mondayOf } from "../core/time.js";

/**
 * The address of the same page for another week, keeping the department.
 * @param {string} monday "YYYY-MM-DD"
 * @param {string | null} departmentId
 * @returns {string}
 */
function weekLink(monday, departmentId) {
  // URLSearchParams escapes the values, so the link can only ever carry these two settings.
  const params = new URLSearchParams({ week: monday });
  if (departmentId) params.set("department", departmentId);
  return `?${params}`;
}

/**
 * Load one week and show it in #week, with links to the weeks before and after.
 * Exported for the tests; the page calls it once when it loads (below).
 * @param {string} search the address's query string, e.g. "?week=2026-10-05"
 */
export async function showWeek(search) {
  const title = document.getElementById("title");
  const status = document.getElementById("status");
  const week = document.getElementById("week");
  const previous = document.getElementById("previous-week");
  const next = document.getElementById("next-week");
  if (!title || !status || !week || !previous || !next) return;

  // Which week and department, from the address. Any week value is turned into the
  // Monday of its week; a missing or malformed one means the current week.
  const params = new URLSearchParams(search);
  const requested = params.get("week");
  const today = dayKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const monday = mondayOf(requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today);
  const departmentId = params.get("department");

  // The heading and the links to the weeks before and after.
  setText(title, `Week of ${formatDayHeading(monday)}`);
  previous.setAttribute("href", weekLink(addDays(monday, -7), departmentId));
  next.setAttribute("href", weekLink(addDays(monday, 7), departmentId));

  try {
    // The seven days of the week, Monday to Sunday.
    const shifts = await listShifts({
      from: monday,
      to: addDays(monday, 6),
      departmentId: departmentId ?? undefined,
    });

    // Name the department in the heading once its shifts are known.
    if (departmentId && shifts.length > 0) {
      setText(title, `${shifts[0].department.name}: week of ${formatDayHeading(monday)}`);
    }

    // All seven days, even empty ones, so the grid always has its seven columns.
    setText(status, "");
    const grouped = groupByDay(shifts);
    const keys = Array.from({ length: 7 }, (_, offset) => addDays(monday, offset));
    week.replaceChildren(
      ...keys.map((key) =>
        daySection(key, grouped.get(key) ?? [], { showDepartment: !departmentId }),
      ),
    );
  } catch (error) {
    // The two failures a page expects get a plain-language message.
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

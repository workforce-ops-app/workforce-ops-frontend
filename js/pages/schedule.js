// Department week: everyone's shifts for one week, a card per day, with open shifts
// highlighted (frontend docs, features/schedules.md). Phones see the days one under
// another; wide screens see the whole week side by side (css/pages/schedule.css).
//
// The address says which week and department to show, so a week can be bookmarked or
// shared: schedule.html?week=2026-10-05&department=<id>. Without a week it shows the
// current one; without a department, every department the person may see (the API
// limits that to their scope).

import { ApiError, NetworkError } from "../api/client.js";
import { listShifts } from "../api/shifts.js";
import { dayCard, groupByDay } from "../components/day-list.js";
import { el, setText } from "../core/dom.js";
import { addDays, formatWeekRange } from "../core/time.js";
import { requestedMonday, today, weekLink } from "../core/week.js";

/**
 * Load one week and show it, with links to the weeks before and after.
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

  // Which week and department, from the address, and the links to other weeks (they keep
  // the department).
  const params = new URLSearchParams(search);
  const todayKey = today();
  const monday = requestedMonday(params, todayKey);
  const departmentId = params.get("department");
  setText(range, formatWeekRange(monday));
  previous.setAttribute("href", weekLink(monday, -1, params));
  next.setAttribute("href", weekLink(monday, 1, params));

  try {
    // The seven days of the week, Monday to Sunday.
    const shifts = await listShifts({
      from: monday,
      to: addDays(monday, 6),
      departmentId: departmentId ?? undefined,
    });

    // Name the department in the heading once its shifts are known.
    if (departmentId && shifts.length > 0) setText(title, shifts[0].department.name);

    // A card for all seven days, even empty ones, with who works each shift.
    setText(status, "");
    const grouped = groupByDay(shifts);
    const keys = Array.from({ length: 7 }, (_, offset) => addDays(monday, offset));
    week.replaceChildren(
      ...keys.map((key) =>
        dayCard(key, grouped.get(key) ?? [], { showEmployee: true, today: todayKey }),
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

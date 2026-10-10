// My week: the signed-in person's shifts for one week, a card per day (days off included),
// and the hours scheduled that week. The home page after signing in; phone first
// (frontend docs, features/schedules.md). The address picks the week: ?week=YYYY-MM-DD.

import { ApiError, NetworkError } from "../api/client.js";
import { listShifts } from "../api/shifts.js";
import { dayCard, groupByDay } from "../components/day-list.js";
import { el, setText } from "../core/dom.js";
import { addDays, formatHours, formatWeekRange, hoursBetween } from "../core/time.js";
import { requestedMonday, today, weekLink } from "../core/week.js";

/**
 * Load one week of the person's shifts and show it.
 * Exported for the tests; the page calls it once when it loads (below).
 * @param {string} search the address's query string, e.g. "?week=2026-10-05"
 */
export async function showMyWeek(search) {
  const range = document.getElementById("week-range");
  const previous = document.getElementById("previous-week");
  const next = document.getElementById("next-week");
  const status = document.getElementById("status");
  const days = document.getElementById("days");
  const summary = document.getElementById("summary");
  if (!range || !previous || !next || !status || !days || !summary) return;

  // Which week, from the address, and the links to the weeks before and after.
  const params = new URLSearchParams(search);
  const todayKey = today();
  const monday = requestedMonday(params, todayKey);
  setText(range, formatWeekRange(monday));
  previous.setAttribute("href", weekLink(monday, -1, params));
  next.setAttribute("href", weekLink(monday, 1, params));

  try {
    // The person's own shifts, Monday to Sunday.
    const shifts = await listShifts({ from: monday, to: addDays(monday, 6), mine: true });

    // A card for every day of the week, so days off show as "No shift".
    setText(status, "");
    const grouped = groupByDay(shifts);
    const keys = Array.from({ length: 7 }, (_, offset) => addDays(monday, offset));
    days.replaceChildren(
      ...keys.map((key) => dayCard(key, grouped.get(key) ?? [], { today: todayKey })),
    );

    // The week's total, e.g. "Time scheduled: 24 hours".
    const total = shifts.reduce((sum, s) => sum + hoursBetween(s.starts_at, s.ends_at), 0);
    summary.replaceChildren(
      el("span", { className: "summary-card__icon" }, [
        el("span", { className: "icon icon--calendar", attrs: { "aria-hidden": "true" } }),
      ]),
      el("p", {}, [
        "Time scheduled: ",
        el("span", { className: "summary-card__value", text: formatHours(total) }),
      ]),
    );
    summary.hidden = false;
  } catch (error) {
    // The two failures a page expects get a plain-language message.
    summary.hidden = true;
    if (error instanceof ApiError || error instanceof NetworkError) {
      const message = error instanceof ApiError ? error.title : "the server could not be reached";
      status.replaceChildren(el("span", { className: "error", text: `Problem: ${message}` }));
      return;
    }
    // Anything else is a bug in our own code: say something went wrong, and throw it on so
    // it reaches the console with its real cause.
    status.replaceChildren(
      el("span", { className: "error", text: "Problem: this page could not load" }),
    );
    throw error;
  }
}

// Show the week the address asks for, once when the page opens.
showMyWeek(window.location.search);

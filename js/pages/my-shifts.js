// My shifts: the signed-in person's upcoming shifts for the next two weeks, grouped by day.
// The home page after signing in (frontend docs, features/schedules.md); phone first.

import { ApiError, NetworkError } from "../api/client.js";
import { listShifts } from "../api/shifts.js";
import { daySection, groupByDay } from "../components/day-list.js";
import { el, setText } from "../core/dom.js";
import { addDays, dayKey } from "../core/time.js";

/** How many days ahead the list reaches. */
const DAYS_AHEAD = 14;

/**
 * Load the upcoming shifts and show them in #days, or a message in #status.
 * Exported for the tests; the page calls it once when it loads (below).
 */
export async function showMyShifts() {
  const status = document.getElementById("status");
  const days = document.getElementById("days");
  if (!status || !days) return;

  try {
    // Today and the next two weeks, counted in the viewer's own calendar (each shift's
    // time is still shown in its workplace zone).
    const today = dayKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    const shifts = await listShifts({
      from: today,
      to: addDays(today, DAYS_AHEAD - 1),
      mine: true,
    });

    // Nothing coming up: say so instead of showing an empty page.
    if (shifts.length === 0) {
      setText(status, "No upcoming shifts in the next two weeks.");
      return;
    }

    // One section per day that has shifts, in date order; the department is shown on each
    // card, since a person can work in more than one.
    setText(status, "");
    const grouped = groupByDay(shifts);
    days.replaceChildren(
      ...[...grouped.keys()]
        .sort()
        .map((key) => daySection(key, grouped.get(key) ?? [], { showDepartment: true })),
    );
  } catch (error) {
    // The two failures a page expects get a plain-language message.
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

// Load the shifts once when the page opens.
showMyShifts();

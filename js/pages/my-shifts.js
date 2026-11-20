// My week: the signed-in person's shifts for one week, a card per day (days off included),
// and the hours scheduled that week. The home page after signing in; phone first
// (frontend docs, features/schedules.md). The address picks the week: ?week=YYYY-MM-DD.
// Under the week, the newest announcements, with a link to all of them
// (features/announcements.md).

import { listAnnouncements } from "../api/announcements.js";
import { ApiError, NetworkError } from "../api/client.js";
import { listShifts } from "../api/shifts.js";
import { announcementCard, workplaceTimeZone } from "../components/announcement-card.js";
import { startSignedInPage } from "../components/app-shell.js";
import { dayCard, groupByDay } from "../components/day-list.js";
import { followWeekLinks } from "../components/week-nav.js";
import { el, setText } from "../core/dom.js";
import { addDays, formatHours, formatWeekRange, hoursBetween } from "../core/time.js";
import { requestedMonday, today, weekLink } from "../core/week.js";

/**
 * Load one week of the person's shifts and show it.
 * Exported for the tests; the page calls it when it loads and for each week chosen with
 * Previous, Next, Back, or Forward (below).
 * @param {string} search the address's query string, e.g. "?week=2026-10-05"
 */
export async function showMyWeek(search) {
  const range = document.getElementById("week-range");
  const previous = document.getElementById("previous-week");
  const current = document.getElementById("current-week");
  const next = document.getElementById("next-week");
  const status = document.getElementById("status");
  const days = document.getElementById("days");
  const summary = document.getElementById("summary");
  if (!range || !previous || !current || !next || !status || !days || !summary) return;

  // Which week, from the address, and the links to the weeks before and after.
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
    // The two failures a page expects get a plain-language message. The week still on
    // screen may be the one before (when moving between weeks), so it goes.
    summary.hidden = true;
    days.replaceChildren();
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

/** How many of the newest announcements the home screen shows. */
export const HOME_ANNOUNCEMENTS = 3;

/**
 * The newest few announcements, under the week. The rest are a link away
 * (pages/announcements.html); the link is in the HTML, so it is there even when this list
 * cannot load. Exported for the tests; the page calls it once, when it loads (moving
 * between weeks leaves the announcements alone).
 */
export async function showHomeAnnouncements() {
  const status = document.getElementById("announcements-status");
  const list = document.getElementById("home-announcements");
  if (!status || !list) return;

  try {
    // Only the first page, and only a few: the home screen is mainly for this week.
    const page = await listAnnouncements({ limit: HOME_ANNOUNCEMENTS });
    const timeZone = workplaceTimeZone();
    // h3: the cards sit under the section's "Announcements" heading (h2).
    list.replaceChildren(
      ...page.items.map((item) =>
        el("li", { className: "announcement-list__item" }, [
          announcementCard(item, { timeZone, headingLevel: 3 }),
        ]),
      ),
    );
    setText(status, page.items.length === 0 ? "No announcements yet." : "");
  } catch (error) {
    // Like the week: the two expected failures in plain words, a bug thrown on.
    if (error instanceof ApiError || error instanceof NetworkError) {
      const message = error instanceof ApiError ? error.title : "the server could not be reached";
      status.replaceChildren(el("span", { className: "error", text: `Problem: ${message}` }));
      return;
    }
    status.replaceChildren(
      el("span", { className: "error", text: "Problem: announcements could not load" }),
    );
    throw error;
  }
}

// Once the session has loaded (signed-out visitors go to the sign-in page instead), show
// the week the address asks for, and the newest announcements under it (both requests at
// once). Other weeks then load in place (components/week-nav.js).
startSignedInPage(async () => {
  followWeekLinks(showMyWeek);
  await Promise.all([showMyWeek(window.location.search), showHomeAnnouncements()]);
});

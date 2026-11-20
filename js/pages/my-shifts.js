// My week: the signed-in person's shifts for one week, a card per day (days off included),
// and the hours scheduled that week. The home page after signing in; phone first
// (frontend docs, features/schedules.md). The address picks the week: ?week=YYYY-MM-DD.
// Under the week, what the person's work calls for (decision 0038; features/schedules.md,
// "Home screen"): managers see what needs their attention (time off to review, the open
// work in their department this week), people who ask for time off see their upcoming
// requests, and everyone sees the newest announcements, with a link to all of them
// (features/announcements.md). Each part is shown only with the permission it needs; that
// is a convenience, since the API checks every request again (threat E8).

import { listAnnouncements } from "../api/announcements.js";
import { ApiError, NetworkError } from "../api/client.js";
import { listShifts } from "../api/shifts.js";
import { myRequests, offerable } from "../api/time-off.js";
import { announcementCard, workplaceTimeZone } from "../components/announcement-card.js";
import { startSignedInPage, waitingRequests } from "../components/app-shell.js";
import { dayCard, groupByDay } from "../components/day-list.js";
import { attentionTiles, timeOffItem, upcomingTimeOff } from "../components/home-sections.js";
import { offerCard } from "../components/offer-card.js";
import { followWeekLinks } from "../components/week-nav.js";
import { openWork } from "../components/week-stats.js";
import { el, setText } from "../core/dom.js";
import { can, currentSession } from "../core/session.js";
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

/**
 * Put a failure in a section's status line: the two failures a page expects in plain
 * words, anything else (a bug in our own code) as a general message and thrown on, so it
 * reaches the console with its real cause.
 * @param {HTMLElement} status
 * @param {unknown} error
 * @param {string} fallback e.g. "Problem: your time off could not load"
 */
function showProblem(status, error, fallback) {
  if (error instanceof ApiError || error instanceof NetworkError) {
    const message = error instanceof ApiError ? error.title : "the server could not be reached";
    status.replaceChildren(el("span", { className: "error", text: `Problem: ${message}` }));
    return;
  }
  status.replaceChildren(el("span", { className: "error", text: fallback }));
  throw error;
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
    showProblem(status, error, "Problem: announcements could not load");
  }
}

/**
 * My time off: the person's requests still waiting for a decision and their approved time
 * off still to come (components/home-sections.js). Only for people who can ask for time
 * off; the section starts hidden in the HTML and applyPermissions shows it. Exported for
 * the tests; the page calls it once, when it loads.
 */
export async function showMyTimeOff() {
  const status = document.getElementById("time-off-status");
  const list = document.getElementById("home-time-off");
  if (!status || !list || !can("time_off.request_self")) return;

  try {
    const upcoming = upcomingTimeOff(await myRequests(), today());
    list.replaceChildren(...upcoming.map(timeOffItem));
    setText(status, upcoming.length === 0 ? "No time off coming up." : "");
  } catch (error) {
    list.replaceChildren();
    showProblem(status, error, "Problem: your time off could not load");
  }
}

/**
 * Coworkers asking for cover (docs/features/coverage.md): their time-off requests still
 * collecting offers, with the shifts this person could take, each with Cover, Swap (one
 * of their own upcoming shifts), and Decline. Only with coverage.respond_self; the API
 * lists only requests the person could answer, and only their own answers. Exported for
 * the tests; the page calls it once, and again after each answer.
 */
export async function showOffers() {
  const status = document.getElementById("offers-status");
  const list = document.getElementById("home-offers");
  if (!status || !list || !can("coverage.respond_self")) return;
  const zone = currentSession()?.company.timezone ?? "UTC";
  try {
    // Step 1: the requests, and the person's own shifts for the next four weeks (the
    // shifts a swap could give).
    const start = today();
    const [items, myShifts] = await Promise.all([
      offerable(),
      listShifts({ from: start, to: addDays(start, 28), mine: true }),
    ]);
    // Step 2: one card each.
    const now = new Date();
    list.replaceChildren(
      ...items.map((item) => offerCard(item, { zone, myShifts, now, onChange: showOffers })),
    );
    setText(status, items.length === 0 ? "Nobody is asking for cover right now." : "");
  } catch (error) {
    list.replaceChildren();
    showProblem(status, error, "Problem: coworkers' requests could not load");
  }
}

/**
 * Needs your attention: for people who review time off, how many requests wait for them;
 * for people who plan the week (schedule.edit), the open shifts and open hours in their
 * own department this week; for people who post announcements, a link to post one. The
 * links under the tiles are in the HTML, each with its own permission. Exported for the
 * tests; the page calls it once, when it loads.
 */
export async function showAttention() {
  const section = document.getElementById("attention");
  const status = document.getElementById("attention-status");
  const tiles = document.getElementById("attention-tiles");
  if (!section || !status || !tiles) return;

  const reviews = can("time_off.review");
  // The person's own department: where they plan, and what the department week opens on.
  const departmentId = currentSession()?.user.department_id ?? null;
  const plans = can("schedule.edit") && departmentId !== null;
  // Posting has a link only (in the HTML), no tile.
  const posts = can("announcement.create");
  // Nothing to show: the whole section stays hidden (it also starts hidden in the HTML).
  section.hidden = !(reviews || plans || posts);
  if (section.hidden) return;
  // Only the link: no tiles, and nothing to ask the server.
  if (!reviews && !plans) {
    tiles.hidden = true;
    setText(status, "");
    return;
  }

  try {
    // Both requests at once; the waiting list is the same request the menu's count uses.
    const monday = requestedMonday(new URLSearchParams(), today());
    const [waiting, shifts] = await Promise.all([
      reviews ? waitingRequests() : null,
      plans ? listShifts({ from: monday, to: addDays(monday, 6), departmentId }) : null,
    ]);
    const work = shifts ? openWork(shifts) : null;
    tiles.replaceChildren(
      ...attentionTiles({
        waiting: waiting ? waiting.length : null,
        open: work ? work.open.length : null,
        openHours: work ? work.openHours : null,
      }),
    );
    tiles.hidden = false;
    setText(status, "");
  } catch (error) {
    tiles.hidden = true;
    showProblem(status, error, "Problem: this section could not load");
  }
}

// Once the session has loaded (signed-out visitors go to the sign-in page instead), show
// the week the address asks for and the sections under it (all their requests at once).
// Other weeks then load in place (components/week-nav.js); the sections stay as they are.
startSignedInPage(async () => {
  followWeekLinks(showMyWeek);
  await Promise.all([
    showMyWeek(window.location.search),
    showAttention(),
    showMyTimeOff(),
    showOffers(),
    showHomeAnnouncements(),
  ]);
});

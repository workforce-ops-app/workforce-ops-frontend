// My time off (pages/time-off.html; docs/features/time-off.md): ask for days off, see
// which of your shifts they affect before sending, and follow or cancel your requests.
//
// Days are whole days in the person's workplace time zone (their home department's, or
// the company's), the same rule as the API. The form does not offer today or earlier, and
// checks the days before sending; the API checks everything again (threat T5).
//
// The reason and any reviewer's comment are shown as text, never as HTML.

import { listDepartments, listShifts } from "../api/shifts.js";
import { askForTimeOff, cancelTimeOff, myRequests, sendUp, viewTimeOff } from "../api/time-off.js";
import { actionButton, reportProblem, say } from "../components/admin-page.js";
import { startSignedInPage } from "../components/app-shell.js";
import { confirmChange } from "../components/confirm-dialog.js";
import { el, setText } from "../core/dom.js";
import { currentSession } from "../core/session.js";
import { addDays, dayKey, formatTimeRange } from "../core/time.js";
import { answerText, dayRange, daysIn, shiftWhen, statusText } from "../core/time-off-words.js";

// Exported again for the tests, which check them with the page.
export { dayRange, daysIn, statusText };

/** @typedef {import("../api/time-off.js").TimeOff} TimeOff */

/** The most days one request may cover (the API's limit). */
export const MAX_DAYS = 30;

// --- Small rules, exported for the tests --------------------------------------------------

/**
 * Whether the person may still cancel it: while it waits, or once approved until its
 * first day.
 * @param {TimeOff} request
 * @param {string} today "YYYY-MM-DD" in the workplace time zone
 */
export function canCancel(request, today) {
  if (["collecting", "pending", "escalated"].includes(request.status)) return true;
  return request.status === "approved" && request.first_day > today;
}

/**
 * What is wrong with the chosen days, or null when they can be sent.
 * @param {string} first
 * @param {string} last
 * @param {string} today
 */
export function daysProblem(first, last, today) {
  if (!first) return "Choose the first day.";
  if (first <= today) return "The first day must be tomorrow or later.";
  if (!last) return "Choose the last day.";
  if (last < first) return "The last day cannot be before the first day.";
  if (daysIn(first, last) > MAX_DAYS) return `A request covers at most ${MAX_DAYS} days.`;
  return null;
}

// --- The page ----------------------------------------------------------------------------

/** The workplace time zone, worked out once the session and departments have loaded. */
let zone = "UTC";

/** Today in the workplace time zone. */
function today() {
  return dayKey(new Date(), zone);
}

export async function showTimeOff() {
  const session = currentSession();
  zone = session?.company.timezone ?? "UTC";
  try {
    // The home department's own time zone, when it has one (the API's rule).
    const home = (await listDepartments()).find((d) => d.id === session?.user.department_id);
    if (home?.timezone) zone = home.timezone;
  } catch {
    // Without the list the company's zone is used; the API checks the days regardless.
  }
  setUpForm();
  await drawRequests();
}

/** The request form: date limits, the affected-shifts preview, and sending. */
function setUpForm() {
  const form = /** @type {HTMLFormElement | null} */ (document.getElementById("time-off-form"));
  const first = /** @type {HTMLInputElement | null} */ (document.getElementById("first-day"));
  const last = /** @type {HTMLInputElement | null} */ (document.getElementById("last-day"));
  const reason = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("reason"));
  const offers = /** @type {HTMLInputElement | null} */ (document.getElementById("offer-coverage"));
  const problem = document.getElementById("form-problem");
  if (!form || !first || !last || !reason || !problem) return;

  // Tomorrow is the earliest day offered; the last day follows the first.
  const tomorrow = addDays(today(), 1);
  first.min = tomorrow;
  last.min = tomorrow;
  first.addEventListener("change", () => {
    last.min = first.value || tomorrow;
    if (first.value && (!last.value || last.value < first.value)) last.value = first.value;
    preview(first.value, last.value);
  });
  last.addEventListener("change", () => preview(first.value, last.value));

  let sending = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    const wrong = daysProblem(first.value, last.value, today());
    problem.hidden = !wrong;
    if (wrong) {
      setText(problem, wrong);
      return;
    }
    sending = true;
    form.setAttribute("aria-busy", "true");
    try {
      const made = await askForTimeOff({
        first_day: first.value,
        last_day: last.value,
        reason: reason.value.trim() || null,
        // Coworkers may offer first (coverage.md); the API says 409 if it is too late.
        offer_coverage: offers?.checked ?? false,
      });
      form.reset();
      document.getElementById("affected")?.replaceChildren();
      say(
        made.status === "collecting"
          ? `Asked your coworkers: ${dayRange(made.first_day, made.last_day)}. Send it to your manager below when you are ready.`
          : `Sent: ${dayRange(made.first_day, made.last_day)}. You can follow it below.`,
      );
      await drawRequests();
    } catch (error) {
      reportProblem(error);
    } finally {
      sending = false;
      form.removeAttribute("aria-busy");
    }
  });
}

/** Counts previews, so an older answer arriving late never replaces a newer one. */
let previewCount = 0;

/**
 * Show which of the person's shifts fall on the chosen days, before sending.
 * @param {string} first
 * @param {string} last
 */
async function preview(first, last) {
  const area = document.getElementById("affected");
  if (!area) return;
  const count = ++previewCount;
  if (daysProblem(first, last, today())) {
    area.replaceChildren();
    return;
  }
  try {
    const shifts = (await listShifts({ from: first, to: last, mine: true })).filter(
      (shift) => shift.status !== "cancelled",
    );
    if (count !== previewCount) return;
    area.replaceChildren(
      shifts.length
        ? el("div", {}, [
            el("p", {
              text: `${shifts.length === 1 ? "1 of your shifts falls" : `${shifts.length} of your shifts fall`} on these days. If approved, ${shifts.length === 1 ? "it becomes an open shift" : "they become open shifts"} for someone else to take:`,
            }),
            el(
              "ul",
              {},
              shifts.map((shift) =>
                el("li", {
                  text: `${dayRange(dayKey(new Date(shift.starts_at), shift.timezone), dayKey(new Date(shift.starts_at), shift.timezone))}, ${formatTimeRange(shift.starts_at, shift.ends_at, shift.timezone)}, ${shift.department.name}`,
                }),
              ),
            ),
          ])
        : el("p", { className: "muted", text: "You have no shifts on these days." }),
    );
  } catch {
    // The preview is a help, not a step: without it the request can still be sent.
    if (count === previewCount) area.replaceChildren();
  }
}

/** The person's requests, newest first. */
async function drawRequests() {
  const list = document.getElementById("request-list");
  if (!list) return;
  /** @type {TimeOff[]} */
  let requests;
  try {
    requests = await myRequests();
  } catch (error) {
    reportProblem(error);
    return;
  }
  if (requests.length === 0) {
    list.replaceChildren(
      el("li", { className: "muted", text: "You have not asked for time off yet." }),
    );
    return;
  }
  list.replaceChildren(...requests.map((request) => requestCard(request)));
}

/**
 * One request: the days, the status, the reason, and its buttons.
 * @param {TimeOff} request
 */
function requestCard(request) {
  const details = el("div", { className: "time-off-card__details" });
  /** @type {HTMLElement[]} */
  const buttons = [];
  // Still with the coworkers: the employee sends it up when ready (coverage.md).
  if (request.status === "collecting") {
    buttons.push(
      actionButton("Send to my manager", () => sendToManager(request), {
        className: "button button--primary",
        ariaLabel: `Send to my manager: ${dayRange(request.first_day, request.last_day)}`,
      }),
    );
  }
  // Asked with offers: see who offered what, by name.
  if (request.offers_close_at) {
    buttons.push(
      actionButton("Coworkers' offers", () => showOffers(request, details), {
        ariaLabel: `Coworkers' offers: ${dayRange(request.first_day, request.last_day)}`,
      }),
    );
  }
  if (canCancel(request, today())) {
    buttons.push(
      actionButton("Cancel request", () => cancel(request), {
        className: "button button--danger-outline",
        ariaLabel: `Cancel time off: ${dayRange(request.first_day, request.last_day)}`,
      }),
    );
  }
  // Comments exist only when someone decided (not for a request nobody reviewed in time).
  if (request.status === "approved" || (request.status === "denied" && !request.not_reviewed)) {
    buttons.push(
      actionButton("Reviewers' comments", () => showComments(request, details), {
        ariaLabel: `Reviewers' comments: ${dayRange(request.first_day, request.last_day)}`,
      }),
    );
  }
  return el("li", { className: `time-off-card time-off-card--${request.status}` }, [
    el("p", {
      className: "time-off-card__days",
      text: dayRange(request.first_day, request.last_day),
    }),
    el("p", { className: "time-off-card__status", text: statusText(request) }),
    ...(request.reason ? [el("p", { className: "muted", text: `Reason: ${request.reason}` })] : []),
    el("div", { className: "person-actions" }, buttons),
    details,
  ]);
}

/**
 * Load the reviewers' comments into the card.
 * @param {TimeOff} request
 * @param {HTMLElement} area
 */
async function showComments(request, area) {
  const detail = await viewTimeOff(request.id);
  const comments = detail.decisions.filter((d) => d.comment);
  area.replaceChildren(
    comments.length
      ? el(
          "ul",
          {},
          comments.map((d) =>
            el("li", { text: `${d.decision === "approve" ? "Approved" : "Denied"}: ${d.comment}` }),
          ),
        )
      : el("p", { className: "muted", text: "No comments." }),
  );
}

/**
 * Load every coworker's offer into the card, under the shift it is about.
 * @param {TimeOff} request
 * @param {HTMLElement} area
 */
async function showOffers(request, area) {
  const detail = await viewTimeOff(request.id);
  area.replaceChildren(offersList(detail, zone));
}

/**
 * The offers on the employee's own request, shift by shift (exported for the tests).
 * @param {import("../api/time-off.js").TimeOffDetail} detail
 * @param {string} workplaceZone
 */
export function offersList(detail, workplaceZone) {
  const offers = detail.offers ?? [];
  if (detail.affected_shifts.length === 0) {
    return el("p", { className: "muted", text: "You have no shifts on these days." });
  }
  return el(
    "ul",
    { className: "offer-card__shifts" },
    detail.affected_shifts.map((shift) => {
      const mine = offers.filter((offer) => offer.shift_id === shift.id);
      return el("li", {}, [
        el("p", { className: "offer-card__when", text: shiftWhen(shift, workplaceZone) }),
        mine.length
          ? el(
              "ul",
              {},
              mine.map((offer) => el("li", { text: answerText(offer, workplaceZone) })),
            )
          : el("p", { className: "muted", text: "No offers yet." }),
      ]);
    }),
  );
}

/** @param {TimeOff} request */
async function sendToManager(request) {
  const done = await confirmChange({
    title: "Send to your manager?",
    message: `${dayRange(request.first_day, request.last_day)}. Coworkers can no longer change their offers after this.`,
    confirmLabel: "Send to my manager",
    run: () => sendUp(request.id),
  });
  if (!done) return;
  say("Sent to your manager.");
  await drawRequests();
}

/** @param {TimeOff} request */
async function cancel(request) {
  const done = await confirmChange({
    title: "Cancel this request?",
    message: `${dayRange(request.first_day, request.last_day)}. ${request.status === "approved" ? "Your shifts on these days stay open; ask your manager if you want them back." : "Nobody needs to review it any more."}`,
    confirmLabel: "Cancel request",
    run: () => cancelTimeOff(request.id),
  });
  if (!done) return;
  say("Cancelled.");
  await drawRequests();
}

// Load the session first (signed-out visitors go to the sign-in page), then the page.
if (document.getElementById("request-list")) {
  startSignedInPage(() => showTimeOff());
}

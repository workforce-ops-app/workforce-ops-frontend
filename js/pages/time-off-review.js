// Review time off (pages/time-off-review.html; docs/features/time-off.md): the manager
// half of time off.
//
//   - Waiting for you: the requests this person may decide now (the API works that out:
//     never their own, only for people below them, and after a disagreement only the
//     manager it moved up to). Each shows who asked, the days, the reason, the shifts it
//     affects, and the other reviewers' decisions so far. Approve, or Deny, each with an
//     optional comment the employee sees.
//   - Team requests (time_off.view): every request of the people in their scope, by
//     status.
//
// Approving opens the employee's shifts on those days for someone else to take; the
// question says so before anything is sent. When coworkers offered to cover or swap a
// shift (docs/features/coverage.md), the card lists the offers under it and the approve
// form lets the reviewer choose none or one per shift; the API checks each choice again. Display only: the API checks every decision
// (threats E5, T5). Names, reasons, and comments are shown as text, never as HTML.

import { listDepartments } from "../api/shifts.js";
import { decideTimeOff, teamRequests, viewTimeOff, waitingForMe } from "../api/time-off.js";
import { actionButton, reportProblem, say } from "../components/admin-page.js";
import { showWaitingCount, startSignedInPage } from "../components/app-shell.js";
import { openFormDialog } from "../components/form-dialog.js";
import { el } from "../core/dom.js";
import { can, currentSession } from "../core/session.js";
import { dayKey, formatTimeRange } from "../core/time.js";
import {
  answerText,
  dayRange,
  decidedText,
  statusText,
  waitingText,
} from "../core/time-off-words.js";

/** @typedef {import("../api/time-off.js").TimeOff} TimeOff */
/** @typedef {import("../api/time-off.js").TimeOffDetail} TimeOffDetail */
/** @typedef {import("../api/time-off.js").Offer} Offer */

// --- Small rules, exported for the tests --------------------------------------------------

/**
 * One line for an affected shift: "Tuesday, November 24, 8:00 AM - 4:00 PM, Kitchen".
 * @param {import("../api/time-off.js").AffectedShift} shift
 * @param {Map<string, { name: string, zone: string }>} departments
 * @param {string} fallbackZone the company's
 */
export function shiftLine(shift, departments, fallbackZone) {
  const department = departments.get(shift.department_id);
  const zone = department?.zone ?? fallbackZone;
  const day = dayKey(new Date(shift.starts_at), zone);
  return `${dayRange(day, day)}, ${formatTimeRange(shift.starts_at, shift.ends_at, zone)}, ${department?.name ?? "another department"}`;
}

/**
 * One reviewer's decision in words: "Chris Nguyen approved: fine by me".
 * @param {import("../api/time-off.js").Decision} decision
 */
export function decisionLine(decision) {
  const verb = decision.decision === "approve" ? "approved" : "denied";
  return decision.comment
    ? `${decision.approver_name} ${verb}: ${decision.comment}`
    : `${decision.approver_name} ${verb}.`;
}

/**
 * The offers a reviewer may choose for one shift: covers and swaps still open, never
 * the reviewer's own (the API refuses that too, threat E12). Declines are only shown.
 * @param {TimeOffDetail} request
 * @param {string} shiftId
 * @param {string | undefined} me the signed-in person's ID
 * @returns {Offer[]}
 */
export function choosable(request, shiftId, me) {
  return (request.offers ?? []).filter(
    (offer) =>
      offer.shift_id === shiftId &&
      offer.status === "offered" &&
      offer.answer !== "decline" &&
      offer.offered_by !== me,
  );
}

/**
 * The choices to send from the approve form's values: one per shift where the reviewer
 * picked an offer ("" means nobody: the shift becomes open).
 * @param {TimeOffDetail} request
 * @param {Record<string, string>} values the form's values, `offer-<shift id>` per shift
 * @returns {{ shift_id: string, offer_id: string }[]}
 */
export function choicesFrom(request, values) {
  return request.affected_shifts
    .map((shift) => ({ shift_id: shift.id, offer_id: values[`offer-${shift.id}`] ?? "" }))
    .filter((choice) => choice.offer_id !== "");
}

/**
 * What the reviewer is told about a request's state.
 * @param {TimeOff} request
 */
export function reviewState(request) {
  if (request.status === "escalated") {
    return "Moved up to you: the managers who reviewed it disagreed. Your decision settles it.";
  }
  // Pending: what the other reviewers already decided (if anyone), then that it waits
  // for this reviewer. The waiting list only holds requests this person has not decided.
  if (request.status !== "pending") return statusText(request);
  return [decidedText(request), "Waiting for your decision."].filter(Boolean).join(" ");
}

// --- The page ----------------------------------------------------------------------------

/** Department names and time zones, for the affected shifts. */
let departments = new Map();

function companyZone() {
  return currentSession()?.company.timezone ?? "UTC";
}

export async function showReview() {
  try {
    departments = new Map(
      (await listDepartments()).map((d) => [
        d.id,
        { name: d.name, zone: d.timezone ?? companyZone() },
      ]),
    );
  } catch {
    // Without names the shifts still show, with the company's time zone.
  }
  const filter = /** @type {HTMLSelectElement | null} */ (document.getElementById("team-status"));
  filter?.addEventListener("change", () => drawTeam(/** @type {any} */ (filter.value)));
  await drawWaiting();
  if (can("time_off.view")) await drawTeam("");
}

/** The requests waiting for this person, each with its details loaded. */
async function drawWaiting() {
  const list = document.getElementById("waiting-list");
  if (!list) return;
  /** @type {TimeOffDetail[]} */
  let requests;
  try {
    const waiting = await waitingForMe();
    requests = await Promise.all(waiting.map((request) => viewTimeOff(request.id)));
  } catch (error) {
    reportProblem(error);
    return;
  }
  if (requests.length === 0) {
    list.replaceChildren(el("li", { className: "muted", text: "Nothing is waiting for you." }));
    return;
  }
  list.replaceChildren(...requests.map((request) => waitingCard(request)));
}

/**
 * One request waiting for a decision.
 * @param {TimeOffDetail} request
 */
function waitingCard(request) {
  const days = dayRange(request.first_day, request.last_day);
  const shifts = request.affected_shifts.map((s) => shiftLine(s, departments, companyZone()));
  return el("li", { className: `time-off-card time-off-card--${request.status}` }, [
    el("p", { className: "time-off-card__days", text: `${request.employee_name}: ${days}` }),
    el("p", { className: "time-off-card__status", text: reviewState(request) }),
    ...(request.reason ? [el("p", { className: "muted", text: `Reason: ${request.reason}` })] : []),
    el("h3", { className: "time-off-card__heading", text: "Shifts it affects" }),
    shifts.length
      ? el(
          "ul",
          {},
          request.affected_shifts.map((shift, index) =>
            el("li", { text: shifts[index] }, offersUnder(request, shift.id)),
          ),
        )
      : el("p", { className: "muted", text: "None: no shifts on these days." }),
    ...(request.decisions.length
      ? [
          el("h3", { className: "time-off-card__heading", text: "Decisions so far" }),
          el(
            "ul",
            {},
            request.decisions.map((d) => el("li", { text: decisionLine(d) })),
          ),
        ]
      : []),
    el("div", { className: "person-actions" }, [
      actionButton("Approve", () => decide(request, "approve", shifts.length), {
        className: "button button--primary",
        ariaLabel: `Approve time off for ${request.employee_name}: ${days}`,
      }),
      actionButton("Deny", () => decide(request, "deny", shifts.length), {
        className: "button button--danger-outline",
        ariaLabel: `Deny time off for ${request.employee_name}: ${days}`,
      }),
    ]),
  ]);
}

/**
 * The coworkers' answers under one shift on the card, by name (as text).
 * @param {TimeOffDetail} request
 * @param {string} shiftId
 * @returns {HTMLElement[]}
 */
function offersUnder(request, shiftId) {
  const offers = (request.offers ?? []).filter((offer) => offer.shift_id === shiftId);
  if (offers.length === 0) return [];
  return [
    el(
      "ul",
      { className: "time-off-card__offers" },
      offers.map((offer) => el("li", { text: answerText(offer, companyZone()) })),
    ),
  ];
}

/**
 * Ask for an optional comment, then send the decision.
 * @param {TimeOffDetail} request
 * @param {"approve" | "deny"} decision
 * @param {number} shiftCount
 */
async function decide(request, decision, shiftCount) {
  const days = dayRange(request.first_day, request.last_day);
  const opens =
    shiftCount === 0
      ? ""
      : ` If this settles it, ${shiftCount === 1 ? "their shift on these days becomes an open shift" : `their ${shiftCount} shifts on these days become open shifts`} for someone else to take.`;
  // With an approval: one select per shift that has offers to choose, "Nobody" first.
  const me = currentSession()?.user.id;
  /** @type {import("../components/form-dialog.js").Field[]} */
  const offerFields =
    decision === "approve"
      ? request.affected_shifts.flatMap((shift) => {
          const offers = choosable(request, shift.id, me);
          if (offers.length === 0) return [];
          return [
            {
              name: `offer-${shift.id}`,
              label: `Who works ${shiftLine(shift, departments, companyZone())}`,
              type: /** @type {const} */ ("select"),
              options: [
                { value: "", label: "Nobody: it becomes an open shift" },
                ...offers.map((offer) => ({
                  value: offer.id,
                  label: answerText(offer, companyZone()),
                })),
              ],
            },
          ];
        })
      : [];
  const done = await openFormDialog({
    title: `${decision === "approve" ? "Approve" : "Deny"} time off for ${request.employee_name}?`,
    lead:
      decision === "approve"
        ? `${days}.${opens}${offerFields.length ? " A coworker you choose below takes the shift instead." : ""}`
        : `${days}. Their shifts stay as they are.`,
    submitLabel: decision === "approve" ? "Approve" : "Deny",
    fields: [
      ...offerFields,
      {
        name: "comment",
        label: "Comment (optional)",
        type: "text",
        hint: `${request.employee_name} sees it.`,
      },
    ],
    run: (values) =>
      decideTimeOff(
        request.id,
        decision,
        values.comment.slice(0, 500) || null,
        decision === "approve" ? choicesFrom(request, values) : [],
      ),
  });
  if (!done) return;
  say(
    `${decision === "approve" ? "Approved" : "Denied"}: ${request.employee_name}, ${days}. ${statusAfter(done)}`,
  );
  await drawWaiting();
  await showWaitingCount();
  if (can("time_off.view")) await drawTeam(currentFilter());
}

/**
 * What the request became after the decision, in words.
 * @param {TimeOff} request
 */
function statusAfter(request) {
  switch (request.status) {
    case "approved":
      return "The time off is approved.";
    case "denied":
      return "The request is declined.";
    case "escalated":
      return "The reviewers disagreed, so it moved up to the next manager.";
    default:
      return "It now waits for the other reviewers.";
  }
}

function currentFilter() {
  const filter = /** @type {HTMLSelectElement | null} */ (document.getElementById("team-status"));
  return /** @type {TimeOff["status"] | ""} */ (filter?.value ?? "");
}

/**
 * Every request of the people in scope, by status.
 * @param {TimeOff["status"] | ""} status
 */
async function drawTeam(status) {
  const list = document.getElementById("team-list");
  if (!list) return;
  /** @type {TimeOff[]} */
  let requests;
  try {
    requests = await teamRequests(status);
  } catch (error) {
    reportProblem(error);
    return;
  }
  list.replaceChildren(
    ...(requests.length
      ? requests.map((request) =>
          el("li", { className: "team-row" }, [
            el("span", { className: "team-row__who", text: request.employee_name }),
            el("span", { text: dayRange(request.first_day, request.last_day) }),
            el("span", {
              className: `team-row__status team-row__status--${request.status}`,
              text: statusLabel(request),
            }),
          ]),
        )
      : [el("li", { className: "muted", text: "No requests." })]),
  );
}

/**
 * A short status for the team list (the reviewer's point of view).
 * @param {TimeOff} request
 */
export function statusLabel(request) {
  // Moved up: the short label, then who it now waits for (when the API names them).
  if (request.status === "escalated") {
    const waiting = waitingText(request);
    return waiting ? `Moved up. ${waiting}` : "Moved up";
  }
  return statusText(request);
}

// Load the session first (signed-out visitors go to the sign-in page), then the page.
if (document.getElementById("waiting-list")) {
  startSignedInPage(() => showReview());
}

// Approvals (pages/admin-approvals.html; docs/features/administration.md): changes that
// wait for someone above, as decision 0032 has it.
//
//   - Waiting for you: the pending requests this person may decide now (the API works
//     that out: never their own, never one about them, only from people below them). Each
//     has Approve and Deny, both behind "Are you sure?". Approving an admin-level change
//     asks for the password again (the API client shows the pop-up).
//   - Yours: the requests they made or that are about them, newest first, with what
//     became of each. One they made and that still waits can be cancelled.
//
// Time-off requests are decided on the time-off screens (the generic decision refuses
// them), so they are left out here. Everything the server sends is shown as text.

import { decide, listRequests } from "../api/approvals.js";
import { listTeams } from "../api/org.js";
import { listDepartments } from "../api/shifts.js";
import {
  actionButton,
  joinNames,
  keepFocus,
  markStale,
  reportProblem,
  say,
} from "../components/admin-page.js";
import { startSignedInPage } from "../components/app-shell.js";
import { confirmChange } from "../components/confirm-dialog.js";
import { el } from "../core/dom.js";
import { currentSession } from "../core/session.js";
import { dayKey, formatDayHeading } from "../core/time.js";

/** @typedef {import("../api/approvals.js").ApprovalRequest} ApprovalRequest */
/** @typedef {{ departments: Map<string, string>, teams: Map<string, string> }} Places */

// --- Small rules, exported for the tests --------------------------------------------------

/**
 * What a request asks for, in one sentence.
 * @param {ApprovalRequest} request
 * @param {Places} places
 */
export function describeRequest(request, places) {
  const who = request.requested_by_name;
  const whom = request.subject_name;
  switch (request.kind) {
    case "role_assignment":
      return `${who} asks to give ${whom} the ${request.role_name ?? "unknown"} role, for ${where(request, places)}.`;
    case "owner_add":
      return `${who} proposes making ${whom} an owner of the company.`;
    case "owner_remove":
      return `${who} proposes that ${whom} stop being an owner of the company.`;
    default:
      return `${who} asks for a change to ${whom}'s account.`;
  }
}

/**
 * Where a role request would apply.
 *
 * The API names the place itself (`scope_name`: the department, the team, or the one
 * person the role would be over), so a reviewer sees exactly who a role "for one person"
 * reaches without looking anyone up (review of #93, point 5; backend #215). The department
 * and team lists are a fallback for an API that does not send the name yet; for one
 * person there is no fallback, because looking people up would need a permission the
 * reviewer may not hold.
 * @param {ApprovalRequest} request
 * @param {Places} places
 */
function where(request, places) {
  const payload = request.payload;
  const id = String(payload.scope_id ?? "");
  const named = request.scope_name ?? null;
  switch (payload.scope_type) {
    case "department":
      return `the ${named ?? places.departments.get(id) ?? "unknown"} department`;
    case "team":
      return `the ${named ?? places.teams.get(id) ?? "unknown"} team`;
    case "employee":
      return named ? `${named} only` : "one person (not named)";
    default:
      return "the whole company";
  }
}

/**
 * What became of a request, in plain words.
 * @param {ApprovalRequest} request
 * @param {string} zone
 */
export function outcome(request, zone) {
  switch (request.status) {
    case "pending": {
      const by = formatDayHeading(dayKey(new Date(request.review_by), zone));
      const to = request.reviewers.map((r) => r.display_name);
      const waiting = to.length ? `Waiting for ${joinNames(to)}` : "Nobody can review it right now";
      return `${waiting}. Declined on ${by} if nobody decides.`;
    }
    case "approved":
      return "Approved.";
    case "denied":
      return request.not_reviewed ? "Declined: nobody decided in time." : "Denied.";
    default:
      return "Cancelled.";
  }
}

/**
 * The requests this screen handles (time off has its own screens).
 * @param {ApprovalRequest[]} requests
 */
export function handledHere(requests) {
  return requests.filter((request) => request.kind !== "time_off");
}

// --- The page ----------------------------------------------------------------------------

/** @type {Places} */
let places = { departments: new Map(), teams: new Map() };

function zone() {
  return currentSession()?.company.timezone ?? "UTC";
}

/** Load the places (for "the Kitchen department"), then both lists. */
export async function showApprovals() {
  try {
    const [departments, teams] = await Promise.all([listDepartments(), listTeams()]);
    places = {
      departments: new Map(departments.map((d) => [d.id, d.name])),
      teams: new Map(teams.map((t) => [t.id, t.name])),
    };
  } catch (error) {
    reportProblem(error);
    return;
  }
  await drawLists();
}

/**
 * Both lists, loaded fresh (after every decision too).
 *
 * `done` is the decision just made ("Cancelled."). It is said only after the lists are
 * loaded, so it never hides a failed reload. If the reload fails, the decision still
 * stands: the status line says both, and the old cards' buttons are turned off, since a
 * request shown as waiting may already be decided (review of #93, point 4).
 * @param {string} [done]
 */
async function drawLists(done = "") {
  /** @type {ApprovalRequest[]} */
  let waiting;
  /** @type {ApprovalRequest[]} */
  let mine;
  try {
    [waiting, mine] = await Promise.all([listRequests("to_review"), listRequests("mine")]);
  } catch (error) {
    markStale("waiting-list", "mine-list");
    reportProblem(error, done);
    return;
  }
  // Drawn so keyboard focus comes back to a rebuilt button, or to the heading when the
  // decided request's card is gone (point 7).
  keepFocus(() => fillBoth(waiting, mine));
  say(done);
}

/**
 * Fill both lists with cards and their buttons.
 * @param {ApprovalRequest[]} waiting
 * @param {ApprovalRequest[]} mine
 */
function fillBoth(waiting, mine) {
  const me = currentSession()?.user.id;
  fill(
    "waiting-list",
    handledHere(waiting),
    (request) => [
      actionButton("Approve", () => decideWith(request, "approve"), {
        className: "button button--primary",
        ariaLabel: `Approve: ${describeRequest(request, places)}`,
        key: `approve:${request.id}`,
      }),
      actionButton("Deny", () => decideWith(request, "deny"), {
        className: "button button--danger-outline",
        ariaLabel: `Deny: ${describeRequest(request, places)}`,
        key: `deny:${request.id}`,
      }),
    ],
    "Nothing is waiting for you.",
  );
  fill(
    "mine-list",
    handledHere(mine),
    (request) =>
      request.status === "pending" && request.requested_by === me
        ? [
            actionButton("Cancel request", () => decideWith(request, "cancel"), {
              key: `cancel:${request.id}`,
            }),
          ]
        : [],
    "You have no requests.",
  );
}

/**
 * Fill one list with request cards.
 * @param {string} listId
 * @param {ApprovalRequest[]} requests
 * @param {(request: ApprovalRequest) => HTMLElement[]} buttons
 * @param {string} empty what to say when there are none
 */
function fill(listId, requests, buttons, empty) {
  const list = document.getElementById(listId);
  if (!list) return;
  if (requests.length === 0) {
    list.replaceChildren(el("li", { className: "muted", text: empty }));
    return;
  }
  list.replaceChildren(
    ...requests.map((request) =>
      el("li", { className: "request-card" }, [
        el("p", { className: "request-card__what", text: describeRequest(request, places) }),
        el("p", { className: "request-card__state muted", text: outcome(request, zone()) }),
        el("div", { className: "person-actions" }, buttons(request)),
      ]),
    ),
  );
}

/**
 * Ask "Are you sure?", then send the decision and load both lists again.
 * @param {ApprovalRequest} request
 * @param {"approve" | "deny" | "cancel"} decision
 */
async function decideWith(request, decision) {
  const words = {
    approve: { title: "Approve this request?", label: "Approve", after: "Approved." },
    deny: { title: "Deny this request?", label: "Deny", after: "Denied." },
    cancel: { title: "Cancel your request?", label: "Cancel request", after: "Cancelled." },
  }[decision];
  const done = await confirmChange({
    title: words.title,
    message: describeRequest(request, places),
    confirmLabel: words.label,
    run: () => decide(request.id, decision),
  });
  if (!done) return;
  // The lists again, and only then what was done (a failed reload is never hidden).
  await drawLists(words.after);
}

// Load the session first (signed-out visitors go to the sign-in page), then the page.
if (document.getElementById("waiting-list")) {
  startSignedInPage(() => showApprovals());
}

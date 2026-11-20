// Time off (docs/features/time-off.md; backend time-off.md). Whole days, both included,
// in the person's workplace time zone (their home department's, or the company's).
//
// The API checks every rule again: the first day must be tomorrow or later, at most 30
// days, no overlap with a request still waiting or approved, and only your own requests
// can be cancelled (an approved one only before its first day).

import { api } from "./client.js";

/**
 * @typedef {{
 *   id: string, employee_id: string, employee_name: string, first_day: string, last_day: string,
 *   reason: string | null,
 *   status: "collecting" | "pending" | "escalated" | "approved" | "denied" | "cancelled",
 *   not_reviewed: boolean, created_at: string, decided_at: string | null,
 *   offers_close_at?: string | null, sent_up_at?: string | null,
 *   progress?: Progress | null,
 * }} TimeOff
 *   collecting: asked with "Offer Shift Swap / Coverage" and still with the coworkers
 *   (docs/features/coverage.md); offers_close_at is when it goes up by itself.
 * @typedef {{ approver_id: string, approver_name: string, decision: "approve" | "deny" }} Step
 * @typedef {{ decided: Step[], waiting_for: { id: string, display_name: string }[] }} Progress
 *   While a request is open: who decided so far and who still has to (null once settled).
 * @typedef {{ id: string, department_id: string, starts_at: string, ends_at: string }} AffectedShift
 * @typedef {{ approver_id: string, approver_name: string, decision: "approve" | "deny", decided_at: string,
 *   comment: string | null }} Decision
 * @typedef {{
 *   id: string, shift_id: string, offered_by: string, offered_by_name: string,
 *   answer: "cover" | "swap" | "decline", swap_shift: AffectedShift | null,
 *   status: "offered" | "chosen" | "not_chosen" | "dropped", updated_at: string,
 * }} Offer
 *   A coworker's answer about one shift. A coworker only ever gets their own; the employee
 *   and the managers get everyone's (the API decides, threat I10).
 * @typedef {TimeOff & { affected_shifts: AffectedShift[], decisions: Decision[], offers?: Offer[] }} TimeOffDetail
 * @typedef {{ request: TimeOff, shifts: AffectedShift[], answers: Offer[] }} Offerable
 *   A coworker's card: a request still collecting, the shifts they could take, their answers.
 */

/** @returns {Promise<TimeOff[]>} the person's own requests, newest first */
export async function myRequests() {
  const answer = await api.get(
    `/api/time-off-requests?${new URLSearchParams({ mine: "true", limit: "200" })}`,
  );
  return answer.items;
}

/**
 * Ask for time off.
 * @param {{ first_day: string, last_day: string, reason: string | null, offer_coverage?: boolean }} body
 *   offer_coverage: let coworkers offer to cover or swap first (coverage.md)
 * @returns {Promise<TimeOffDetail>}
 */
export function askForTimeOff(body) {
  return api.post("/api/time-off-requests", body);
}

/**
 * Cancel one of your own requests.
 * @param {string} id
 * @returns {Promise<TimeOff>}
 */
export function cancelTimeOff(id) {
  return api.post(`/api/time-off-requests/${encodeURIComponent(id)}/cancel`);
}

/**
 * One request, with the shifts it affects and the decisions so far.
 * @param {string} id
 * @returns {Promise<TimeOffDetail>}
 */
export function viewTimeOff(id) {
  return api.get(`/api/time-off-requests/${encodeURIComponent(id)}`);
}

// --- Reviewing (the review screen) --------------------------------------------------------

/** @returns {Promise<TimeOff[]>} the requests waiting for this person's decision */
export async function waitingForMe() {
  const answer = await api.get(
    `/api/time-off-requests/waiting?${new URLSearchParams({ limit: "200" })}`,
  );
  return answer.items;
}

/**
 * Requests of the people in this person's time_off.view scope, newest first.
 * @param {TimeOff["status"] | ""} status "" for every status
 * @returns {Promise<TimeOff[]>}
 */
export async function teamRequests(status) {
  const params = new URLSearchParams({ limit: "200" });
  if (status) params.set("status", status);
  const answer = await api.get(`/api/time-off-requests?${params}`);
  return answer.items;
}

/**
 * Approve or deny as a reviewer, with an optional comment the employee sees.
 * @param {string} id
 * @param {"approve" | "deny"} decision
 * @param {string | null} comment
 * @returns {Promise<TimeOff>}
 */
export function decideTimeOff(id, decision, comment) {
  return api.post(`/api/time-off-requests/${encodeURIComponent(id)}/${decision}`, { comment });
}

// --- Swaps and coverage (docs/features/coverage.md) ----------------------------------------

/**
 * Send your own collecting request up to your managers now (offers close).
 * @param {string} id
 * @returns {Promise<TimeOff>}
 */
export function sendUp(id) {
  return api.post(`/api/time-off-requests/${encodeURIComponent(id)}/send-up`);
}

/** @returns {Promise<Offerable[]>} coworkers' requests this person could answer, soonest first */
export async function offerable() {
  const answer = await api.get("/api/time-off-requests/offerable");
  return answer.items;
}

/**
 * Answer for one shift of a coworker's request: cover it, swap it for one of your own
 * shifts, or decline. Replaces an earlier answer; the API checks every rule again.
 * @param {string} requestId
 * @param {string} shiftId
 * @param {"cover" | "swap" | "decline"} answer
 * @param {string | null} swapShiftId the shift you give, for a swap only
 * @returns {Promise<Offer>}
 */
export function answerOffer(requestId, shiftId, answer, swapShiftId = null) {
  const body = swapShiftId ? { answer, swap_shift_id: swapShiftId } : { answer };
  return api.put(
    `/api/time-off-requests/${encodeURIComponent(requestId)}/offers/${encodeURIComponent(shiftId)}`,
    body,
  );
}

/**
 * Take back your answer for one shift.
 * @param {string} requestId
 * @param {string} shiftId
 */
export function withdrawOffer(requestId, shiftId) {
  return api.delete(
    `/api/time-off-requests/${encodeURIComponent(requestId)}/offers/${encodeURIComponent(shiftId)}`,
  );
}

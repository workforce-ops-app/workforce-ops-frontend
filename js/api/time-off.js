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
 *   status: "pending" | "escalated" | "approved" | "denied" | "cancelled",
 *   not_reviewed: boolean, created_at: string, decided_at: string | null,
 *   progress?: Progress | null,
 * }} TimeOff
 * @typedef {{ approver_id: string, approver_name: string, decision: "approve" | "deny" }} Step
 * @typedef {{ decided: Step[], waiting_for: { id: string, display_name: string }[] }} Progress
 *   While a request is open: who decided so far and who still has to (null once settled).
 * @typedef {{ id: string, department_id: string, starts_at: string, ends_at: string }} AffectedShift
 * @typedef {{ approver_id: string, approver_name: string, decision: "approve" | "deny", decided_at: string,
 *   comment: string | null }} Decision
 * @typedef {TimeOff & { affected_shifts: AffectedShift[], decisions: Decision[] }} TimeOffDetail
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
 * @param {{ first_day: string, last_day: string, reason: string | null }} body
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

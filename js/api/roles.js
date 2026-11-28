// Roles, who holds them, and who reports to whom (backend authorization.md: role
// endpoints, reporting-line endpoints). Used by the People screen.
//
// Giving a role answers 201 when it was given, or 202 when it is at the giver's own level
// and waits for someone above to approve it (decision 0032). The two answers have
// different shapes; giveRole tells them apart so the page can say "Done" or "Sent for
// approval to ...". Sensitive changes (an admin-level role, any reporting line) may first
// answer "reauth-required": the API client then shows the password pop-up and repeats
// the request (js/components/reauth-dialog.js), so callers never see that answer.

import { api, getAll } from "./client.js";

/**
 * @typedef {{ id: string, name: string, built_in: string | null, archived: boolean,
 *   permissions: string[] }} Role
 * @typedef {{ id: string, user_id: string, role_id: string, role_name: string,
 *   built_in: string | null, role_archived: boolean,
 *   scope_type: "company" | "department" | "team" | "employee", scope_id: string | null }} Assignment
 * @typedef {{ id: string, display_name: string }} Reviewer
 * @typedef {{ id: string, kind: string, status: string, reviewers: Reviewer[] }} PendingRequest
 * @typedef {{ given: true, assignment: Assignment } | { given: false, request: PendingRequest }} GiveResult
 * @typedef {{ id: string, manager_id: string, employee_id: string, created_at: string,
 *   ended_at: string | null }} Line
 */

/** @returns {Promise<Role[]>} every role of the company, archived ones included */
export async function listRoles() {
  const answer = await api.get("/api/roles");
  return answer.items;
}

/**
 * The roles one person holds, and where.
 * @param {string} userId
 * @returns {Promise<Assignment[]>}
 */
export async function listAssignments(userId) {
  const answer = await api.get(`/api/role-assignments?${new URLSearchParams({ user_id: userId })}`);
  return answer.items;
}

/**
 * Give a role: at once (201), or as a request waiting for approval (202).
 * @param {{ user_id: string, role_id: string, scope_type: string, scope_id: string | null }} grant
 * @returns {Promise<GiveResult>}
 */
export async function giveRole(grant) {
  const answer = await api.post("/api/role-assignments", grant);
  // A 202 answer is an approval request (it has a kind); a 201 answer is the assignment.
  return "kind" in answer
    ? { given: false, request: /** @type {PendingRequest} */ (answer) }
    : { given: true, assignment: /** @type {Assignment} */ (answer) };
}

/**
 * Take a role away.
 * @param {string} assignmentId
 * @returns {Promise<null>}
 */
export function removeAssignment(assignmentId) {
  return api.delete(`/api/role-assignments/${encodeURIComponent(assignmentId)}`);
}

/**
 * The current reporting lines a person is part of, as manager or as employee.
 * @param {string} userId
 * @returns {Promise<Line[]>}
 */
export async function listLines(userId) {
  const answer = await api.get(`/api/reporting-lines?${new URLSearchParams({ user_id: userId })}`);
  return answer.items;
}

/**
 * Record that the employee reports to the manager.
 * @param {string} managerId
 * @param {string} employeeId
 * @returns {Promise<Line>}
 */
export function addLine(managerId, employeeId) {
  return api.post("/api/reporting-lines", { manager_id: managerId, employee_id: employeeId });
}

/**
 * End a reporting line (it is kept as history).
 * @param {string} lineId
 * @returns {Promise<Line>}
 */
export function endLine(lineId) {
  return api.post(`/api/reporting-lines/${encodeURIComponent(lineId)}/end`);
}

/** @returns {Promise<{ id: string, department_id: string, name: string, archived: boolean }[]>} */
export function listTeams() {
  return getAll("/api/teams");
}

// Roles, who holds them, and who reports to whom (backend authorization.md: role
// endpoints, reporting-line endpoints). Used by the People screen.
//
// Giving a role answers 201 when it was given, or 202 when it is at the giver's own level
// and waits for someone above to approve it (decision 0032). The two answers have
// different shapes; giveRole tells them apart so the page can say "Done" or "Sent for
// approval to ...". Sensitive changes (an admin-level role, any reporting line) may first
// answer "reauth-required": the API client then shows the password pop-up and repeats
// the request (js/components/reauth-dialog.js), so callers never see that answer.

import { api } from "./client.js";

/**
 * @typedef {{ id: string, name: string, built_in: string | null, archived: boolean,
 *   permissions: string[], you_may_change: boolean }} Role
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

// The teams list lives with the rest of the structure (org.js).
export { listTeams } from "./org.js";

// --- Roles themselves (the Roles and owners screen) --------------------------------------

/**
 * @typedef {{ code: string, kind: string, description: string }} Permission
 * @typedef {{ id: string, display_name: string }} Owner
 * @typedef {{ done: true, owners: Owner[] } | { done: false, request: PendingRequest }} OwnerResult
 */

/** @returns {Promise<Permission[]>} every permission a role can grant */
export async function listPermissions() {
  const answer = await api.get("/api/permissions");
  return answer.items;
}

/**
 * A new role. Only permissions the person holds themselves are accepted (rule AZ3).
 * @param {string} name
 * @param {string[]} permissions
 * @returns {Promise<Role>}
 */
export function createRole(name, permissions) {
  return api.post("/api/roles", { name, permissions });
}

/**
 * Rename a role or replace what it grants (only the fields sent change). Changing what it
 * grants asks for the password again (the API client shows the pop-up).
 * @param {string} id
 * @param {{ name?: string, permissions?: string[] }} changes
 * @returns {Promise<Role>}
 */
export function updateRole(id, changes) {
  return api.patch(`/api/roles/${encodeURIComponent(id)}`, changes);
}

/**
 * Archive a role: its holders lose what it grants at once (password asked again).
 * @param {string} id
 * @returns {Promise<Role>}
 */
export function archiveRole(id) {
  return api.post(`/api/roles/${encodeURIComponent(id)}/archive`);
}

/** @returns {Promise<Owner[]>} the company's owners, by name */
export async function listOwners() {
  const answer = await api.get("/api/owners");
  return answer.items;
}

/**
 * The answer of an owner change: done at once (200, the owners now), or waiting for the
 * other owners (202, an approval request).
 * @param {any} answer
 * @returns {OwnerResult}
 */
function ownerResult(answer) {
  return "kind" in answer
    ? { done: false, request: /** @type {PendingRequest} */ (answer) }
    : { done: true, owners: answer.items };
}

/**
 * Propose a new owner (owners only; every other owner must agree).
 * @param {string} userId
 * @returns {Promise<OwnerResult>}
 */
export async function addOwner(userId) {
  return ownerResult(await api.post("/api/owners", { user_id: userId }));
}

/**
 * Propose that someone stop being an owner (never the last one).
 * @param {string} userId
 * @returns {Promise<OwnerResult>}
 */
export async function removeOwner(userId) {
  return ownerResult(await api.post(`/api/owners/${encodeURIComponent(userId)}/remove`));
}

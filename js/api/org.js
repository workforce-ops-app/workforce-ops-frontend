// The company's structure: departments and teams, and who is in each team (backend
// organization.md). Used by the Departments and teams screen. Every change needs
// org.manage; the API checks it, the screen only hides what would be refused.
//
// The lists hold active departments and teams only: an archived one disappears from them
// (its history stays: past shifts keep pointing at it).

import { api, getAll } from "./client.js";

/**
 * @typedef {{ id: string, name: string, timezone: string | null, archived: boolean }} Department
 * @typedef {{ id: string, department_id: string, name: string, archived: boolean }} Team
 */

/**
 * A new department. No time zone: the company's applies.
 * @param {{ name: string, timezone?: string | null }} body
 * @returns {Promise<Department>}
 */
export function createDepartment(body) {
  return api.post("/api/departments", body);
}

/**
 * Rename a department or change its time zone (only the fields sent change).
 * @param {string} id
 * @param {{ name?: string, timezone?: string | null }} changes
 * @returns {Promise<Department>}
 */
export function updateDepartment(id, changes) {
  return api.patch(`/api/departments/${encodeURIComponent(id)}`, changes);
}

/**
 * Archive a department (refused while it still has people or teams; the API says why).
 * @param {string} id
 * @returns {Promise<Department>}
 */
export function archiveDepartment(id) {
  return api.post(`/api/departments/${encodeURIComponent(id)}/archive`);
}

/** @returns {Promise<Team[]>} every active team */
export function listTeams() {
  return getAll("/api/teams");
}

/**
 * @param {string} departmentId
 * @param {string} name
 * @returns {Promise<Team>}
 */
export function createTeam(departmentId, name) {
  return api.post("/api/teams", { department_id: departmentId, name });
}

/**
 * @param {string} id
 * @param {string} name
 * @returns {Promise<Team>}
 */
export function renameTeam(id, name) {
  return api.patch(`/api/teams/${encodeURIComponent(id)}`, { name });
}

/**
 * @param {string} id
 * @returns {Promise<Team>}
 */
export function archiveTeam(id) {
  return api.post(`/api/teams/${encodeURIComponent(id)}/archive`);
}

/**
 * @param {string} teamId
 * @param {string} userId
 * @returns {Promise<{ team_id: string, user_id: string }>}
 */
export function addMember(teamId, userId) {
  return api.post(`/api/teams/${encodeURIComponent(teamId)}/members`, { user_id: userId });
}

/**
 * @param {string} teamId
 * @param {string} userId
 * @returns {Promise<null>}
 */
export function removeMember(teamId, userId) {
  return api.delete(
    `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
  );
}

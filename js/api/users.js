// People and their accounts (backend organization.md, People; authentication.md, setup and
// reset links). Used by the People screen (pages/admin-people.html).
//
// The API decides who may see and change whom: a list holds only the people the user's
// user.view covers, and every change needs user.manage over the person and a place above
// them in the reporting chain (AZ5). you_are_above on each person is a hint, so the page
// offers buttons only where they can work; the API checks every request regardless.

import { api, getAll } from "./client.js";

/**
 * A person as the API shows them.
 * @typedef {{
 *   id: string, display_name: string, email: string, department_id: string,
 *   team_ids: string[], status: "invited" | "active" | "deactivated", locked: boolean,
 *   you_are_above: boolean,
 * }} Person
 */

/**
 * A setup or reset link, shown once (the server keeps only its hash).
 * @typedef {{ purpose: "setup" | "reset", link: string, expires_at: string }} NewLink
 */

/** @returns {Promise<Person[]>} everyone the user may see, all pages */
export function listPeople() {
  return getAll("/api/users", new URLSearchParams({ limit: "200" }));
}

/**
 * Create an account; it has no password until its setup link is used.
 * @param {{ display_name: string, email: string, department_id: string, manager_id?: string }} person
 * @returns {Promise<Person>}
 */
export function createPerson(person) {
  return api.post("/api/users", person);
}

/**
 * Change a person's name, email, or home department (only the fields given).
 * @param {string} id
 * @param {{ display_name?: string, email?: string, department_id?: string }} changes
 * @returns {Promise<Person>}
 */
export function changePerson(id, changes) {
  return api.patch(`/api/users/${encodeURIComponent(id)}`, changes);
}

/**
 * One of the account actions. Deactivating answers with the person plus the upcoming
 * shifts still assigned to them (upcoming_shift_ids), for someone to reassign.
 * @param {string} id
 * @param {"deactivate" | "reactivate" | "unlock"} action
 * @returns {Promise<Person & { upcoming_shift_ids?: string[] }>}
 */
export function accountAction(id, action) {
  return api.post(`/api/users/${encodeURIComponent(id)}/${action}`);
}

/**
 * Sign a person out on every browser.
 * @param {string} id
 * @returns {Promise<null>}
 */
export function signPersonOut(id) {
  return api.delete(`/api/users/${encodeURIComponent(id)}/sessions`);
}

/**
 * A new setup link (an account without a password) or reset link (a forgotten one). Any
 * earlier link of the person stops working.
 * @param {string} id
 * @param {"setup" | "reset"} purpose
 * @returns {Promise<NewLink>}
 */
export function makeLink(id, purpose) {
  return api.post(`/api/users/${encodeURIComponent(id)}/${purpose}-link`);
}

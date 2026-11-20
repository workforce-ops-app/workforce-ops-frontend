// Your own account: entering the password again, changing it, and setting one from a link
// (docs/features/sign-in.md; backend authentication.md). Every request goes through the
// API client, like all the others.

import { api } from "./client.js";

/**
 * Enter the password again before a sensitive action (POST /api/sessions/current/reauth).
 * For the next 5 minutes this browser may do sensitive actions; a wrong password is 403.
 * @param {string} password exactly as typed
 * @returns {Promise<null>}
 */
export function reenterPassword(password) {
  return api.post("/api/sessions/current/reauth", { password });
}

/**
 * Change your own password (PUT /api/me/password). Every other browser is signed out, and
 * this one gets a new session: the answer carries the new CSRF token.
 * @param {string} currentPassword
 * @param {string} newPassword
 * @returns {Promise<import("../core/session.js").SessionInfo>}
 */
export function changePassword(currentPassword, newPassword) {
  return api.put("/api/me/password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

/**
 * Set a password with a setup or reset link (POST /api/password-links/redeem). Nobody is
 * signed in: the link's token is the proof. It goes in the body, never in an address, so
 * it does not end up in server logs.
 * @param {string} token the part after "#token=" in the link
 * @param {string} newPassword
 * @returns {Promise<null>}
 */
export function setPasswordWithLink(token, newPassword) {
  return api.post("/api/password-links/redeem", { token, new_password: newPassword });
}

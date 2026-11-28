// Your own account: entering the password again, changing it, and setting one from a link
// (docs/features/sign-in.md; backend authentication.md). Every request goes through the
// API client, like all the others.

import { ApiError, api } from "./client.js";

// The backend's words for a plain wrong password, at re-entry and when changing the
// password (backend app/auth/reauth.py, WRONG_PASSWORD; security event auth.reauth_failed).
export const WRONG_PASSWORD_DETAIL = "That password is not right.";

/**
 * Why the server refused a password with 403, when the reason is NOT a plain wrong
 * password; null when it is (or when this is not a 403 at all).
 *
 * Both refusals are 403 with the same problem type, so only the server's explanation tells
 * them apart:
 *   - a wrong password: "That password is not right." (auth.reauth_failed); the page
 *     says so in its own words and the person tries again;
 *   - a locked account, after too many wrong passwords: "Too many wrong passwords. Wait a
 *     while and try again." (auth.reauth_locked). While the lock lasts the server does not
 *     even try the password, so "not right" would be misleading: the person would keep
 *     retrying a password that may well be correct. Its explanation is shown as it is.
 * Any other 403 with an explanation (one the backend may add later) is shown in the
 * server's words too, which is always closer to the truth than "wrong password". A 403
 * without one counts as a wrong password, as before. Shown as text only, never as HTML.
 * @param {unknown} error
 * @returns {string | null}
 */
export function passwordRefusal(error) {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  if (!error.detail || error.detail === WRONG_PASSWORD_DETAIL) return null;
  return error.detail;
}

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

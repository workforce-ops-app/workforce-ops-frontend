import { api } from "./client.js";

/**
 * Sign in using an email and password.
 * The backend creates the session and sets an HttpOnly cookie.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>} The signed-in user, company, permissions, and expiration.
 */
export function signIn(email, password) {
  return api.post("/api/sessions", { email, password });
}

/**
 * Retrieve the currently signed-in user.
 * Returns an API error (401) if no valid session exists.
 */
export function getCurrentSession() {
  return api.get("/api/sessions/current");
}

/**
 * Sign out of the current browser session.
 */
export function signOut() {
  return api.delete("/api/sessions/current");
}

/**
 * Sign out from every device.
 */
export function signOutEverywhere() {
  return api.delete("/api/sessions");
}

/**
 * Sign up a new company: creates the company and its owner, and signs the owner in
 * (backend POST /api/sign-up). The backend sets the HttpOnly session cookie, exactly as
 * at sign-in, and answers with the same body.
 *
 * @param {{ company_name: string, timezone: string, display_name: string, email: string,
 *   password: string }} form
 * @returns {Promise<object>} The new owner, their company, permissions, and expiration.
 */
export function signUp(form) {
  return api.post("/api/sign-up", form);
}

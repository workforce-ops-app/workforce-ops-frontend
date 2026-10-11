// Who is signed in, and what they may do. Every signed-in page starts here.
//
// Course topics: AJAX and CSRF.
// - AJAX: when a page opens, its script asks the server "who am I?" in the background
//   (GET /api/sessions/current) and then fills in the page, without reloading it.
// - CSRF: the same answer carries the anti-forgery token (csrf_token). It is handed to the
//   API client, which sends it as the X-CSRF-Token header on every request that changes
//   something. Another site can make the browser send our cookie, but it can never read
//   this token, so it cannot forge such a request (threat model S4).
//
// The session cookie itself is HttpOnly: no script can read it, this one included. What
// this module keeps (the person, their permissions, the token) lives in memory only, never
// in localStorage or sessionStorage, so it is gone when the tab closes and no other script
// on a later visit can find it.
//
// Permissions here only decide what the page shows. Hiding a button is a convenience: the
// server checks every request itself (threat model E8), so someone who un-hides a button
// in the browser's developer tools still gets 403.

import { ApiError, setCsrfToken } from "../api/client.js";
import { getCurrentSession, signOut as endSession } from "../api/sessions.js";

/** Where signed-out visitors are sent. A fixed path: never taken from the address. */
export const SIGN_IN_PAGE = "/pages/sign-in.html";

/**
 * The answer of GET /api/sessions/current (backend authentication.md).
 * @typedef {{
 *   user: { id: string, display_name: string, email: string, department_id: string },
 *   company: { id: string, name: string, timezone: string },
 *   permissions: string[],
 *   expires_at: string,
 *   csrf_token: string
 * }} SessionInfo
 */

/** @type {SessionInfo | null} the signed-in person, once loaded */
let current = null;

/** @type {Promise<SessionInfo | null> | null} the one request per page (see loadSession) */
let loading = null;

/**
 * Leave for another page. A parameter so the tests can watch where the page goes.
 * @param {string} path
 */
function goTo(path) {
  window.location.assign(path);
}

/**
 * Ask the server who is signed in, once per page, and remember the answer.
 *
 * Several parts of a page may ask at the same time (the header, the page itself); they all
 * share one request instead of sending one each.
 *
 * Resolves to the session, or to null when nobody is signed in (401): the visitor is then
 * sent to the sign-in page, and the caller should stop, since nothing on a signed-in page
 * can load. Any other failure (the server is down, a 500) is thrown on, so the page shows
 * its usual "Problem: ..." message instead of a confusing trip to the sign-in page.
 *
 * @param {(path: string) => void} [navigate] where to go when signed out (tests pass a fake)
 * @returns {Promise<SessionInfo | null>}
 */
export function loadSession(navigate = goTo) {
  if (!loading) {
    loading = (async () => {
      try {
        const info = /** @type {SessionInfo} */ (await getCurrentSession());
        current = info;
        // From now on every POST, PATCH, PUT, and DELETE carries the token.
        setCsrfToken(info.csrf_token);
        return info;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          // Not signed in, or the session expired or was ended elsewhere.
          forgetSession();
          navigate(SIGN_IN_PAGE);
          return null;
        }
        // Let a later call try again instead of reusing the failure.
        loading = null;
        throw error;
      }
    })();
  }
  return loading;
}

/**
 * The signed-in person, or null before loadSession() has finished (or when signed out).
 * @returns {SessionInfo | null}
 */
export function currentSession() {
  return current;
}

/**
 * Whether the signed-in person holds a permission somewhere (in any of their roles' scopes).
 * Only for deciding what to show; see the top of this file.
 * @param {string} permission e.g. "schedule.edit"
 * @returns {boolean}
 */
export function can(permission) {
  return current?.permissions.includes(permission) ?? false;
}

/** Drop everything this page knew about the session, including the CSRF token. */
export function forgetSession() {
  current = null;
  loading = null;
  setCsrfToken(null);
}

/**
 * Sign out of this browser session and go to the sign-in page.
 *
 * The request (DELETE /api/sessions/current) carries the CSRF token like any change, so
 * another site cannot sign the person out either. A 401 means the session had already
 * ended, which is the outcome we wanted, so it counts as signed out. Any other failure is
 * thrown on: the page stays, and the person can try again.
 *
 * @param {(path: string) => void} [navigate]
 */
export async function signOut(navigate = goTo) {
  try {
    await endSession();
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
  }
  forgetSession();
  navigate(SIGN_IN_PAGE);
}

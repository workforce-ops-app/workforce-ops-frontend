// My account (pages/account.html; docs/features/sign-in.md): change your password, and
// sign out everywhere. Reached from your name in the header of every signed-in page.
//
// Changing the password (PUT /api/me/password) signs out every other browser. This one
// gets a NEW session in the answer: a new cookie (set by the server) and a new CSRF token,
// which this page hands to the API client at once, since the old token went with the old
// session.
//
// Signing out everywhere (DELETE /api/sessions) ends this browser's session too, so the
// page then goes to the sign-in page. It asks first: every phone and computer is affected.

import { ApiError, NetworkError, setCsrfToken } from "../api/client.js";
import { changePassword } from "../api/account.js";
import { signOutEverywhere } from "../api/sessions.js";
import { startSignedInPage } from "../components/app-shell.js";
import { confirmChange } from "../components/confirm-dialog.js";
import { setText } from "../core/dom.js";
import { RULES_TEXT, passwordProblem } from "../core/password-rules.js";
import { SIGN_IN_PAGE, currentSession, forgetSession } from "../core/session.js";

/**
 * Explain a failed password change in plain words, or null for a bug in our own code.
 * @param {unknown} error
 * @returns {string | null}
 */
export function explainPasswordChange(error) {
  if (error instanceof NetworkError) {
    return "The server could not be reached, so the password may or may not have changed. Try signing in with the new one if this page stops working.";
  }
  if (!(error instanceof ApiError)) return null;
  if (error.status === 401) return "Your session has ended. Sign in again, then try once more.";
  // The current password was wrong: the server answers 403 and records it.
  if (error.status === 403) return "Your current password is not right.";
  if (error.status === 429) {
    const wait = error.retryAfter ? ` Try again in ${error.retryAfter} seconds.` : "";
    return `Too many attempts.${wait}`;
  }
  if (error.status === 422) {
    if (error.errors.length > 0) return error.errors.map((problem) => problem.message).join(" ");
    return error.detail || "This password cannot be used. Please choose another.";
  }
  const reference = error.errorId ? ` Reference: ${error.errorId}.` : "";
  return `Something went wrong. Please try again.${reference}`;
}

/**
 * Fill in the page and handle its two actions.
 * @param {{
 *   change?: typeof changePassword,
 *   endAll?: typeof signOutEverywhere,
 *   confirm?: typeof confirmChange,
 *   navigate?: (path: string) => void,
 * }} [options] tests pass fakes
 */
export async function showAccount(options = {}) {
  const change = options.change ?? changePassword;
  const endAll = options.endAll ?? signOutEverywhere;
  const confirm = options.confirm ?? confirmChange;
  const navigate = options.navigate ?? ((path) => window.location.assign(path));

  const session = currentSession();
  const who = document.getElementById("account-who");
  const username = document.getElementById("account-username");
  if (session) {
    // From the server, shown as text only.
    if (who) setText(who, `Signed in as ${session.user.display_name} (${session.user.email})`);
    if (username instanceof HTMLInputElement) username.value = session.user.email;
  }
  const rules = document.getElementById("password-rules");
  if (rules) setText(rules, RULES_TEXT);

  // --- Change your password ---
  const form = document.getElementById("password-form");
  const message = document.getElementById("password-message");
  const done = document.getElementById("password-done");
  if (form instanceof HTMLFormElement && message && done) {
    const current = /** @type {HTMLInputElement} */ (form.querySelector("#current-password"));
    const next = /** @type {HTMLInputElement} */ (form.querySelector("#new-password"));
    const repeat = /** @type {HTMLInputElement} */ (form.querySelector("#repeat-password"));
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));

    /** @param {string} text @param {HTMLInputElement} field */
    const show = (text, field) => {
      setText(message, text);
      message.hidden = false;
      field.setAttribute("aria-invalid", "true");
      field.focus();
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (button.disabled) return; // one request at a time
      message.hidden = true;
      done.hidden = true;
      for (const field of [current, next, repeat]) field.removeAttribute("aria-invalid");

      if (!current.value) {
        show("Please enter your current password.", current);
        return;
      }
      const problem = passwordProblem(next.value, repeat.value);
      if (problem) {
        show(problem, next);
        return;
      }

      button.disabled = true;
      setText(button, "Changing...");
      try {
        const fresh = await change(current.value, next.value);
        // The old session (and its token) is gone; use the new one from now on.
        setCsrfToken(fresh.csrf_token);
        for (const field of [current, next, repeat]) field.value = "";
        setText(done, "Your password is changed. Every other browser was signed out.");
        done.hidden = false;
      } catch (error) {
        const text = explainPasswordChange(error);
        if (text === null) throw error; // a bug in our own code: to the console
        show(text, error instanceof ApiError && error.status === 403 ? current : next);
      } finally {
        button.disabled = false;
        setText(button, "Change password");
      }
    });
  }

  // --- Sign out everywhere ---
  const endButton = document.getElementById("sign-out-everywhere");
  const endMessage = document.getElementById("sessions-message");
  endButton?.addEventListener("click", async () => {
    if (endMessage) endMessage.hidden = true;
    /** @type {boolean} */
    let ended;
    try {
      ended = await confirm({
        title: "Sign out everywhere?",
        message: "Every phone and computer where you are signed in is signed out, this one too.",
        confirmLabel: "Sign out everywhere",
        run: async () => {
          try {
            await endAll();
          } catch (error) {
            // Already signed out (401) is what was wanted.
            if (!(error instanceof ApiError && error.status === 401)) throw error;
          }
        },
      });
    } catch (error) {
      if (endMessage) {
        setText(endMessage, "Something went wrong. Please try again.");
        endMessage.hidden = false;
      }
      throw error;
    }
    if (ended) {
      forgetSession();
      navigate(SIGN_IN_PAGE);
    }
  });
}

// Load the session first (signed-out visitors go to the sign-in page), then the page.
if (document.getElementById("password-form")) {
  startSignedInPage(() => showAccount());
}

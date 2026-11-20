// Set your password from a setup or reset link (docs/features/sign-in.md; backend
// authentication.md, "Setup and reset links"; threat S2).
//
// A manager hands over a link like https://<host>/set-password.html#token=<token> (nginx
// sends that address on to this page and the "#..." part travels with it). The token is
// after the "#" on purpose: browsers never send that part to any server, so it is not in
// any access log. This page:
//   1. reads the token from the address once, and keeps it in memory only;
//   2. removes it from the address bar at once (history.replaceState), so it is not left
//      in the browser's history for the next person at a shared computer;
//   3. sends it in the request body, with the new password, to
//      POST /api/password-links/redeem.
// A link works once and for a short time. Every reason it does not work gets one answer
// from the server (400), so the page cannot tell, and does not say, which reason it was.

import { ApiError, NetworkError } from "../api/client.js";
import { setPasswordWithLink } from "../api/account.js";
import { setText } from "../core/dom.js";
import { RULES_TEXT, passwordProblem } from "../core/password-rules.js";

/** What the page says when the link does not work, whatever the reason. */
export const LINK_NOT_WORKING =
  "This link does not work. It may have been used already or have expired. " +
  "Ask your manager for a new one.";

/**
 * Take the token out of the address: return it, and remove it from the address bar.
 * @param {Location} [where]
 * @param {History} [history]
 * @returns {string | null} the token, or null when the address has none
 */
export function takeToken(where = window.location, history = window.history) {
  const token = new URLSearchParams(where.hash.slice(1)).get("token");
  if (where.hash) {
    // The same page without the "#...": nothing is reloaded, and Back does not bring the
    // token back (replace, not push).
    history.replaceState(null, "", where.pathname + where.search);
  }
  return token ? token : null;
}

/**
 * Explain a failed request in plain words, or null for a bug in our own code.
 * @param {unknown} error
 * @returns {string | null}
 */
export function explain(error) {
  if (error instanceof NetworkError) return "Unable to reach the server. Please try again.";
  if (!(error instanceof ApiError)) return null;
  if (error.status === 400) return LINK_NOT_WORKING;
  if (error.status === 429) {
    const wait = error.retryAfter ? ` Try again in ${error.retryAfter} seconds.` : "";
    return `Too many attempts.${wait}`;
  }
  if (error.status === 422) {
    // The server's reason ("This password is too common."), written for people. Shown as
    // text only. Field errors from the request checks come as a list.
    if (error.errors.length > 0) return error.errors.map((problem) => problem.message).join(" ");
    return error.detail || "This password cannot be used. Please choose another.";
  }
  const reference = error.errorId ? ` Reference: ${error.errorId}.` : "";
  return `Something went wrong. Please try again.${reference}`;
}

/**
 * Set up the page: take the token, show the rules, and handle the form.
 * @param {{ token: string | null, send?: typeof setPasswordWithLink }} options
 */
export function startSetPassword({ token, send = setPasswordWithLink }) {
  const form = document.getElementById("set-password-form");
  const message = document.getElementById("set-password-message");
  const done = document.getElementById("set-password-done");
  const rules = document.getElementById("password-rules");
  const intro = document.getElementById("set-password-intro");
  if (
    !(form instanceof HTMLFormElement) ||
    !(message instanceof HTMLElement) ||
    !(done instanceof HTMLElement)
  ) {
    throw new Error("The set-password page is missing required elements.");
  }
  if (rules) setText(rules, RULES_TEXT);

  /** @param {string} text */
  const show = (text) => {
    setText(message, text);
    message.hidden = false;
  };

  // No token: an incomplete link (cut off when copied). Nothing to send.
  if (!token) {
    form.hidden = true;
    if (intro) intro.hidden = true;
    show(LINK_NOT_WORKING);
    return;
  }

  const password = /** @type {HTMLInputElement} */ (form.querySelector("#new-password"));
  const repeat = /** @type {HTMLInputElement} */ (form.querySelector("#repeat-password"));
  const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return; // one request at a time
    message.hidden = true;
    password.removeAttribute("aria-invalid");

    // Every character counts, spaces included: the passwords are sent exactly as typed.
    const problem = passwordProblem(password.value, repeat.value);
    if (problem) {
      password.setAttribute("aria-invalid", "true");
      show(problem);
      password.focus();
      return;
    }

    button.disabled = true;
    setText(button, "Setting password...");
    try {
      await send(token, password.value);
    } catch (error) {
      const text = explain(error);
      button.disabled = false;
      setText(button, "Set password");
      if (text === null) throw error; // a bug in our own code: to the console
      show(text);
      // A link that does not work will not start working: stop offering the form.
      if (error instanceof ApiError && error.status === 400) form.hidden = true;
      return;
    }
    // Done: clear the fields, so nothing stays on a shared screen, and point to sign-in.
    password.value = "";
    repeat.value = "";
    form.hidden = true;
    if (intro) intro.hidden = true;
    done.hidden = false;
  });
}

// When the page opens: take the token from the address first, before anything else runs.
if (document.getElementById("set-password-form")) {
  startSetPassword({ token: takeToken() });
}

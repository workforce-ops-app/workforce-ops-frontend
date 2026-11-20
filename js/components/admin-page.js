// What the administration pages share (docs/features/administration.md): the status line
// at the top of the page, and buttons that run a change and report a failure there.
//
// The status line (#status, role="status") says what just happened ("Sent for approval
// to Owen.") or what went wrong. A refusal from the server is shown as text; a bug in our
// own code is thrown on, so it reaches the console instead of hiding behind a message.

import { ApiError, NetworkError } from "../api/client.js";
import { el, setText } from "../core/dom.js";

/**
 * Say something in the page's status line.
 * @param {string} message
 */
export function say(message) {
  const status = document.getElementById("status");
  if (status) setText(status, message);
}

/**
 * Show a failure in the page's status line, or throw a bug on.
 * @param {unknown} error
 */
export function reportProblem(error) {
  const status = document.getElementById("status");
  if (error instanceof ApiError || error instanceof NetworkError) {
    const message =
      error instanceof ApiError ? error.detail || error.title : "the server could not be reached";
    status?.replaceChildren(el("span", { className: "error", text: `Problem: ${message}` }));
    return;
  }
  status?.replaceChildren(
    el("span", { className: "error", text: "Problem: something went wrong on this page" }),
  );
  throw error;
}

/**
 * A button that runs an action; a failure goes to the status line.
 * @param {string} label
 * @param {() => Promise<unknown>} action
 * @param {{ className?: string, ariaLabel?: string }} [options]
 * @returns {HTMLButtonElement}
 */
export function actionButton(label, action, options = {}) {
  /** @type {Record<string, string>} */
  const attrs = { type: "button" };
  if (options.ariaLabel) attrs["aria-label"] = options.ariaLabel;
  const button = /** @type {HTMLButtonElement} */ (
    el("button", { className: options.className ?? "button", text: label, attrs })
  );
  button.addEventListener("click", async () => {
    try {
      await action();
    } catch (error) {
      reportProblem(error);
    }
  });
  return button;
}

/**
 * Join names for a sentence: "A", "A and B", "A, B and C".
 * @param {string[]} names
 */
export function joinNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

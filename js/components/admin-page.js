// What the administration pages share (docs/features/administration.md): the status line
// at the top of the page, and buttons that run a change and report a failure there.
//
// The status line (#status, role="status") says what just happened ("Sent for approval
// to Owen.") or what went wrong. A refusal from the server is shown as text; a bug in our
// own code is thrown on, so it reaches the console instead of hiding behind a message.
//
// After a change, a page loads its list again and draws it. keepFocus() puts keyboard
// focus back on the rebuilt button; if the reload fails, markStale() turns off the old
// list's buttons and the status line says the change was saved but the list is old.

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
 *
 * `done` is for a list loaded again after a change that worked: the change itself was
 * saved, only the refresh failed. Then the line says both ("Cancelled. The list could not
 * be loaded again ..."), so the person neither thinks the change failed nor trusts a list
 * that is out of date (review of #93, point 4).
 * @param {unknown} error
 * @param {string} [done] what was just saved, if the failure came after it
 */
export function reportProblem(error, done = "") {
  const status = document.getElementById("status");
  if (error instanceof ApiError || error instanceof NetworkError) {
    // The server's own explanation, or a plain one when it could not be reached.
    const message =
      error instanceof ApiError ? error.detail || error.title : "the server could not be reached";
    // After a saved change: say it was saved, then why the page is out of date.
    const text = done
      ? `${done} The page could not be loaded again (${message}), so what it shows may be out of date. Reload the page to see where things stand.`
      : `Problem: ${message}`;
    status?.replaceChildren(el("span", { className: "error", text }));
    return;
  }
  status?.replaceChildren(
    el("span", { className: "error", text: "Problem: something went wrong on this page" }),
  );
  throw error;
}

/**
 * A button that runs an action; a failure goes to the status line.
 *
 * `key` names the button for keepFocus(): the same key on the rebuilt button (say
 * "department-change:<id>") lets focus come back to it after the list is drawn again.
 * @param {string} label
 * @param {() => Promise<unknown>} action
 * @param {{ className?: string, ariaLabel?: string, key?: string }} [options]
 * @returns {HTMLButtonElement}
 */
export function actionButton(label, action, options = {}) {
  /** @type {Record<string, string>} */
  const attrs = { type: "button" };
  if (options.ariaLabel) attrs["aria-label"] = options.ariaLabel;
  if (options.key) attrs["data-key"] = options.key;
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
 * Draw a list again without losing the keyboard user's place (review of #93, point 7).
 *
 * Drawing a list replaces its buttons, including the one that opened the popup, so focus
 * would fall back to the page itself and a keyboard or screen reader user would have to
 * start again from the top. So: note which keyed button had focus (or that focus was
 * already lost), draw, then focus the new button with the same key. When that button is
 * gone (the department was archived, the request decided), focus goes to the page's
 * heading instead, the nearest sensible place. Focus somewhere else on the page (the
 * person moved on while the list loaded) is left alone.
 * @param {() => void} draw builds the list again
 */
export function keepFocus(draw) {
  // Step 1: where focus is now. A keyed button (or something inside one), or nowhere.
  const active = document.activeElement;
  const keyed = active instanceof HTMLElement ? active.closest("[data-key]") : null;
  const key = keyed instanceof HTMLElement ? keyed.dataset.key : undefined;
  const lost = !active || active === document.body;
  // Step 2: draw the list again.
  draw();
  // Step 3: put focus back only if it was on a keyed button or had been lost.
  if (!key && !lost) return;
  // The rebuilt button with the same key (compared as text, so no key can bend a selector).
  const again = [...document.querySelectorAll("[data-key]")].find(
    (node) => node instanceof HTMLElement && node.dataset.key === key,
  );
  if (again instanceof HTMLElement) {
    again.focus();
    return;
  }
  // Otherwise the page's heading; tabIndex -1 lets a script focus it without adding a tab
  // stop.
  const heading = document.querySelector("main h1");
  if (heading instanceof HTMLElement) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

/**
 * Turn off the buttons in lists that could not be loaded again (review of #93, point 4):
 * they act on what the list showed before, which may no longer be true (a request already
 * cancelled still showing "Cancel request"). The status line says to reload the page.
 * @param {...string} listIds
 */
export function markStale(...listIds) {
  for (const id of listIds) {
    for (const button of document.getElementById(id)?.querySelectorAll("button") ?? []) {
      button.disabled = true;
    }
  }
}

/**
 * Join names for a sentence: "A", "A and B", "A, B and C".
 * @param {string[]} names
 */
export function joinNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

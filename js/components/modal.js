// A popup for edit mode's forms and questions (js/components/shift-form.js and
// js/components/confirm-dialog.js), built on the browser's own <dialog> element like the
// shift details popup (js/components/shift-dialog.js):
// - showModal() makes the rest of the page unclickable and unreachable with Tab while the
//   popup is open, and Escape closes it, without any code of ours;
// - it needs no inline script or style, so the Content Security Policy allows it;
// - when it closes, keyboard focus goes back to whatever opened it.
//
// Each call makes a fresh popup and removes it from the page when it closes, so one form's
// fields and messages can never linger into the next.

import { ApiError, NetworkError } from "../api/client.js";
import { el } from "../core/dom.js";

/**
 * Why a change was refused, in plain words for the popup that tried it.
 *
 * The server's own explanation is used where there is one: its 409 and 422 answers are
 * already written for people ("This person already has a shift at that time."), and they
 * name only this company's data, so showing them reveals nothing new. They are put on the
 * page as text (el(), textContent), never as HTML.
 * @param {unknown} error what the request threw
 * @returns {string | null} the message, or null for a bug in our own code (thrown on)
 */
export function explainFailure(error) {
  if (error instanceof NetworkError) {
    return "The server could not be reached. Nothing was saved; try again.";
  }
  if (!(error instanceof ApiError)) return null;
  // 422 from the request checks: one line per field ("Input should be a valid UUID").
  if (error.errors.length > 0) {
    return error.errors.map((problem) => problem.message).join(" ");
  }
  if (error.status === 401) return "Your session has ended. Sign in again to save changes.";
  return error.detail || error.title;
}

/**
 * @typedef {{
 *   box: HTMLDialogElement,
 *   open: (focus?: HTMLElement | null) => void,
 *   close: () => void,
 * }} Modal
 */

/**
 * Create a popup, not yet shown.
 * @param {{ className: string, labelledBy: string, onClose?: () => void }} options
 *   className styles it; labelledBy is the ID of its heading, which names it for screen
 *   readers; onClose runs however it was closed (a button, Escape, or close())
 * @returns {Modal}
 */
export function createModal(options) {
  const box = /** @type {HTMLDialogElement} */ (
    el("dialog", { className: options.className, attrs: { "aria-labelledby": options.labelledBy } })
  );
  // Whatever had focus before (the button that opened the popup), to return to.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  box.addEventListener("close", () => {
    box.remove();
    options.onClose?.();
    opener?.focus();
  });

  return {
    box,
    open(focus) {
      document.body.append(box);
      // showModal() in every supported browser; a plain open attribute otherwise (the test
      // environment), so the content can still be checked.
      if (typeof box.showModal === "function") {
        box.showModal();
      } else {
        box.setAttribute("open", "");
      }
      focus?.focus();
    },
    close() {
      if (!box.isConnected) return;
      if (typeof box.close === "function" && box.open) {
        box.close();
      } else {
        // The test environment has no close(): do what it would do.
        box.removeAttribute("open");
        box.dispatchEvent(new Event("close"));
      }
    },
  };
}

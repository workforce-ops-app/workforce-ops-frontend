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
 * A change sent as two requests where the first was saved and the second was not (changing
 * a shift: its times and text, then who works it). The page must not say "nothing was
 * saved" then, because part of it was.
 */
export class PartlySaved extends Error {
  /**
   * @param {string} message what was saved and what was not, in plain words
   * @param {unknown} cause why the second request failed
   */
  constructor(message, cause) {
    super(message, { cause });
    this.name = "PartlySaved";
  }
}

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
  // What was saved first, then why the rest was not.
  if (error instanceof PartlySaved) {
    const why = explainFailure(error.cause);
    return why === null ? null : `${error.message} ${why}`;
  }
  if (error instanceof NetworkError) {
    // No answer does not mean nothing happened: the request may have reached the server
    // and been saved before the connection failed. Sending it again blindly could add the
    // same shift twice, so the message says to look first.
    return (
      "The server could not be reached, so the change may or may not have been saved. " +
      "Check the schedule before trying again."
    );
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
 *   setBusy: (busy: boolean) => void,
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

  // While a change is being sent, the popup must stay open: closing it would look like
  // "cancelled" even though the server may still save the change a moment later.
  let busy = false;
  /** @type {Element | null} what had focus when the popup became busy */
  let focusedBeforeBusy = null;
  // Escape fires "cancel" before the popup closes; preventing it keeps the popup open.
  // Browsers only let a page do that once in a row (so a page can never trap someone), so
  // the forms also handle being closed anyway: see confirm-dialog.js and shift-form.js.
  box.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });

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
    setBusy(on) {
      busy = on;
      // aria-busy tells screen readers the popup is working; every button (Go back
      // included) is off until the answer arrives, so it cannot be sent twice or left.
      box.toggleAttribute("aria-busy", on);
      if (on) focusedBeforeBusy = document.activeElement;
      for (const button of box.querySelectorAll("button")) button.toggleAttribute("disabled", on);
      // A button that is switched off loses focus; give it back once it is on again, so
      // keyboard users do not land at the top of the page.
      if (!on && focusedBeforeBusy instanceof HTMLElement && box.contains(focusedBeforeBusy)) {
        focusedBeforeBusy.focus();
      }
    },
  };
}

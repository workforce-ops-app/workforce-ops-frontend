// "Are you sure?" before a change that is hard to undo: cancelling shifts, and any batch of
// 10 or more shifts ("This will change 14 shifts.", decision 0025, threat D3).
//
// The question stays open while the change is sent. If the server refuses it, the reason
// is shown right in the question (role="alert", so screen readers read it at once), and
// the person can try again or go back; nothing is lost.
//
// While the change is being sent, the question cannot be left (Go back is off, Escape is
// held back): leaving it would look like "nothing happened" while the server might still
// save the change. If the browser closes it anyway, the answer is still waited for, so a
// saved change is still reported and the week still loads again.

import { el } from "../core/dom.js";
import { createModal, explainFailure } from "./modal.js";

/**
 * Ask before a change, and send it once confirmed.
 * @param {{
 *   title: string, message: string, confirmLabel: string, run: () => Promise<unknown>,
 * }} options run sends the change; it runs only after the confirm button is pressed
 * @returns {Promise<boolean>} true once the change was saved (even if the question was
 *   closed while it was being sent); false when the person went back without saving
 */
export function confirmChange(options) {
  return new Promise((resolve, reject) => {
    let saved = false;
    // True while the change is on its way to the server.
    let sending = false;
    const modal = createModal({
      className: "edit-dialog edit-dialog--confirm",
      labelledBy: "confirm-title",
      // Closed without saving (Back or Escape): nothing changed. Closed while sending: the
      // answer decides, below.
      onClose: () => {
        if (!sending) resolve(saved);
      },
    });

    const problem = el("p", { className: "form__message", attrs: { role: "alert" } });
    problem.hidden = true;

    const back = el("button", {
      className: "button",
      text: "Go back",
      attrs: { type: "button" },
    });
    back.addEventListener("click", () => modal.close());

    const confirm = el("button", {
      className: "button button--primary button--danger",
      text: options.confirmLabel,
      attrs: { type: "button" },
    });
    confirm.addEventListener("click", async () => {
      // One request at a time: a double click must not send the change twice.
      if (sending) return;
      sending = true;
      modal.setBusy(true);
      problem.hidden = true;
      /** @type {{ error: unknown } | null} what went wrong, if anything */
      let failure = null;
      try {
        await options.run();
        saved = true;
      } catch (error) {
        failure = { error };
      }
      sending = false;
      modal.setBusy(false);

      if (failure) {
        const message = explainFailure(failure.error);
        if (message === null) {
          // A bug in our own code: let it reach the console, and close.
          reject(failure.error);
          modal.close();
          return;
        }
        // Still open: show why, and let the person try again or go back.
        if (modal.box.isConnected) {
          problem.textContent = message;
          problem.hidden = false;
          return;
        }
      }
      // Saved (close the question), or the browser closed it while sending (report what
      // happened now that the answer is known).
      modal.close();
      resolve(saved);
    });

    modal.box.append(
      el("h2", {
        className: "edit-dialog__title",
        text: options.title,
        attrs: { id: "confirm-title" },
      }),
      el("p", { className: "edit-dialog__lead", text: options.message }),
      problem,
      el("div", { className: "edit-dialog__buttons" }, [back, confirm]),
    );
    // Start on "Go back": pressing Enter by reflex must not cancel shifts.
    modal.open(back);
  });
}

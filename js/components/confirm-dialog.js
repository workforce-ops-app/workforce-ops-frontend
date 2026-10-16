// "Are you sure?" before a change that is hard to undo: cancelling shifts, and any batch of
// 10 or more shifts ("This will change 14 shifts.", decision 0025, threat D3).
//
// The question stays open while the change is sent. If the server refuses it, the reason
// is shown right in the question (role="alert", so screen readers read it at once), and
// the person can try again or go back; nothing is lost.

import { el } from "../core/dom.js";
import { createModal, explainFailure } from "./modal.js";

/**
 * Ask before a change, and send it once confirmed.
 * @param {{
 *   title: string, message: string, confirmLabel: string, run: () => Promise<unknown>,
 * }} options run sends the change; it runs only after the confirm button is pressed
 * @returns {Promise<boolean>} true once the change was saved; false when the person went
 *   back (the Back button or Escape) without saving
 */
export function confirmChange(options) {
  return new Promise((resolve, reject) => {
    let saved = false;
    const modal = createModal({
      className: "edit-dialog edit-dialog--confirm",
      labelledBy: "confirm-title",
      // Closed without saving (Back or Escape): nothing changed.
      onClose: () => resolve(saved),
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
      if (confirm.hasAttribute("disabled")) return;
      confirm.setAttribute("disabled", "");
      problem.hidden = true;
      try {
        await options.run();
        saved = true;
        modal.close();
      } catch (error) {
        const message = explainFailure(error);
        if (message === null) {
          // A bug in our own code: close and let it reach the console.
          modal.close();
          reject(error);
          return;
        }
        problem.textContent = message;
        problem.hidden = false;
      } finally {
        confirm.removeAttribute("disabled");
      }
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

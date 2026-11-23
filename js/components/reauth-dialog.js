// The password re-entry pop-up (docs/features/sign-in.md; backend authentication.md,
// "Re-entering the password"; threat S5).
//
// Some actions are sensitive enough that a signed-in browser alone is not proof: giving an
// admin-level role, changing the owners, ending a reporting line. For those the API
// answers 403 with the problem type "reauth-required". The API client (js/api/client.js)
// then calls the handler registered here: this pop-up asks for the password, sends it to
// POST /api/sessions/current/reauth, and resolves to true once it was accepted. The client
// then repeats the original request once. For 5 minutes after that, sensitive actions on
// this browser go through without asking again.
//
// The password is only ever in the field and in the one request; it is never kept.

import { ApiError, NetworkError, onReauthRequired } from "../api/client.js";
import { reenterPassword } from "../api/account.js";
import { el } from "../core/dom.js";
import { createModal } from "./modal.js";

/**
 * Ask for the password again.
 * @param {(password: string) => Promise<unknown>} [send] sends it (tests pass a fake)
 * @returns {Promise<boolean>} true once accepted; false when the person went back
 */
export function askForPassword(send = reenterPassword) {
  return new Promise((resolve) => {
    let accepted = false;
    let sending = false;
    const modal = createModal({
      className: "reauth-dialog",
      labelledBy: "reauth-title",
      onClose: () => resolve(accepted),
    });

    // A form, so Enter sends it and password managers recognise it. method="post" for
    // the same reason as on the sign-in page: if the script were gone, the password must
    // not travel in an address.
    const form = /** @type {HTMLFormElement} */ (
      el("form", { className: "form", attrs: { method: "post", novalidate: "" } })
    );
    const input = /** @type {HTMLInputElement} */ (
      el("input", {
        className: "field__input",
        attrs: {
          id: "reauth-password",
          name: "password",
          type: "password",
          // current-password: a password manager offers the saved one; pasting is allowed.
          autocomplete: "current-password",
          required: "",
        },
      })
    );
    const problem = el("p", {
      className: "form__message",
      attrs: { id: "reauth-message", role: "alert" },
    });
    problem.hidden = true;

    const back = el("button", { className: "button", text: "Go back", attrs: { type: "button" } });
    back.addEventListener("click", () => modal.close());
    const confirm = el("button", {
      className: "button button--primary",
      text: "Confirm",
      attrs: { type: "submit" },
    });

    /** @param {string} message */
    const showProblem = (message) => {
      problem.textContent = message;
      problem.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", "reauth-message");
      input.focus();
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      // One request at a time: pressing Enter twice must not send it twice.
      if (sending) return;
      if (!input.value) {
        showProblem("Please enter your password.");
        return;
      }
      sending = true;
      modal.setBusy(true);
      try {
        await send(input.value);
        accepted = true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          showProblem("That password is not right. Please try again.");
        } else if (error instanceof ApiError && error.status === 401) {
          showProblem("Your session has ended. Sign in again, then try once more.");
        } else if (error instanceof ApiError && error.status === 429) {
          const wait = error.retryAfter ? ` Try again in ${error.retryAfter} seconds.` : "";
          showProblem(`Too many attempts.${wait}`);
        } else if (error instanceof ApiError || error instanceof NetworkError) {
          showProblem("The password could not be checked. Please try again.");
        } else {
          // A bug in our own code: close (the action is not repeated), and let it reach
          // the console with its real cause.
          sending = false;
          modal.setBusy(false);
          modal.close();
          throw error;
        }
      }
      sending = false;
      modal.setBusy(false);
      // The password is not needed any more: clear it before closing, whatever happens.
      if (accepted) {
        input.value = "";
        modal.close();
      }
    });

    form.append(
      el("div", { className: "field" }, [
        el("label", {
          className: "field__label",
          text: "Password",
          attrs: { for: "reauth-password" },
        }),
        input,
      ]),
      problem,
      el("div", { className: "reauth-dialog__buttons" }, [back, confirm]),
    );
    modal.box.append(
      el("h2", {
        className: "reauth-dialog__title",
        text: "Confirm it is you",
        attrs: { id: "reauth-title" },
      }),
      el("p", {
        className: "reauth-dialog__lead",
        text: "This change needs your password again. After that, you will not be asked again for 5 minutes.",
      }),
      form,
    );
    modal.open(input);
  });
}

/** Let the API client use this pop-up on this page (app-shell.js calls it once). */
export function useReauthDialog() {
  onReauthRequired(() => askForPassword());
}

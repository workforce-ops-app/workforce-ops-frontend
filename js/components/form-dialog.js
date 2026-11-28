// A small form in a popup, for the administration screens: add a person, change their
// details, give a role, add a reporting line (docs/features/administration.md).
//
// Built on the shared popup (modal.js): the rest of the page is unreachable while it is
// open, Escape closes it, and focus goes back to the button that opened it. The form stays
// open while its request is sent; if the server refuses, its reason is shown in the form
// (as text, role="alert") and the person can correct it or go back. Nothing is lost.
//
// A select's choices may depend on the other fields (give a role: the places to choose
// from depend on whether it is for a department, a team, or one person). Such a field
// gives a function for its options; the field is rebuilt whenever another field changes.

import { ApiError } from "../api/client.js";
import { el } from "../core/dom.js";
import { createModal, explainFailure } from "./modal.js";

// The shape the API accepts for an email address (backend app/modules/org/schemas.py): no
// spaces, one "@", and a dot somewhere after it. Checked here first, so a typing mistake
// gets a plain message without a request.
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** What a person sees for an email address the API would not accept. */
export const INVALID_EMAIL = "Enter a valid email address.";

/**
 * @typedef {{ value: string, label: string }} Choice
 * @typedef {Record<string, string>} Values
 * @typedef {{
 *   name: string, label: string, type: "text" | "email" | "select",
 *   value?: string, required?: boolean, autocomplete?: string, hint?: string,
 *   options?: Choice[] | ((values: Values) => Choice[]),
 *   shown?: (values: Values) => boolean,
 * }} Field
 */

/**
 * Show a form; resolve once it was sent successfully (to what run returned) or with null
 * when the person went back.
 * @template T
 * @param {{
 *   title: string, lead?: string, submitLabel: string, fields: Field[],
 *   run: (values: Values) => Promise<T>,
 * }} options
 * @returns {Promise<T | null>}
 */
export function openFormDialog(options) {
  return new Promise((resolve, reject) => {
    /** @type {{ result: T } | null} */
    let done = null;
    let sending = false;
    const modal = createModal({
      className: "edit-dialog",
      labelledBy: "form-dialog-title",
      onClose: () => {
        if (!sending) resolve(done ? done.result : null);
      },
    });

    /** @type {Values} the current value of every field */
    const values = {};
    for (const field of options.fields) values[field.name] = field.value ?? "";

    const form = /** @type {HTMLFormElement} */ (
      el("form", { className: "form", attrs: { method: "post", novalidate: "" } })
    );
    // Its own grid, spaced like the form, so the fields do not touch.
    const fieldArea = el("div", { className: "form" });
    const problem = el("p", { className: "form__message", attrs: { role: "alert" } });
    problem.hidden = true;

    /** Build the fields again from the current values (for choices that depend on them). */
    const render = () => {
      // In order, one field at a time: building a select settles its value (its first
      // choice by default), and the fields after it may depend on that value.
      /** @type {HTMLElement[]} */
      const rows = [];
      for (const field of options.fields) {
        if (!field.shown || field.shown(values)) rows.push(fieldRow(field, values, render));
      }
      fieldArea.replaceChildren(...rows);
    };
    render();

    const back = el("button", { className: "button", text: "Go back", attrs: { type: "button" } });
    back.addEventListener("click", () => modal.close());
    const submit = el("button", {
      className: "button button--primary",
      text: options.submitLabel,
      attrs: { type: "submit" },
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (sending) return; // one request at a time
      problem.hidden = true;
      // Required fields first, on the page: no request for an empty name.
      const missing = options.fields.find(
        (field) => field.required && (!field.shown || field.shown(values)) && !values[field.name],
      );
      if (missing) {
        problem.textContent = `Please fill in ${missing.label.toLowerCase()}.`;
        problem.hidden = false;
        const empty = form.querySelector(`[name="${missing.name}"]`);
        if (empty instanceof HTMLElement) empty.focus();
        return;
      }
      // Then the shape of email addresses, the same rule as the API's.
      const badEmail = options.fields.find(
        (field) =>
          field.type === "email" &&
          (!field.shown || field.shown(values)) &&
          values[field.name] &&
          !EMAIL_SHAPE.test(values[field.name]),
      );
      if (badEmail) {
        problem.textContent = INVALID_EMAIL;
        problem.hidden = false;
        const input = form.querySelector(`[name="${badEmail.name}"]`);
        if (input instanceof HTMLElement) input.focus();
        return;
      }
      sending = true;
      modal.setBusy(true);
      try {
        done = { result: await options.run({ ...values }) };
      } catch (error) {
        const message = explainFormFailure(error, options.fields);
        sending = false;
        modal.setBusy(false);
        if (message === null) {
          modal.close();
          reject(error); // a bug in our own code: to the console
          return;
        }
        if (modal.box.isConnected) {
          problem.textContent = message;
          problem.hidden = false;
          return;
        }
        resolve(null); // closed by the browser meanwhile: nothing was saved
        return;
      }
      sending = false;
      modal.setBusy(false);
      modal.close();
      if (!modal.box.isConnected) resolve(done.result);
    });

    form.append(
      fieldArea,
      problem,
      el("div", { className: "edit-dialog__buttons" }, [back, submit]),
    );
    modal.box.append(
      el("h2", {
        className: "edit-dialog__title",
        text: options.title,
        attrs: { id: "form-dialog-title" },
      }),
      ...(options.lead ? [el("p", { className: "edit-dialog__lead", text: options.lead })] : []),
      form,
    );
    modal.open(/** @type {HTMLElement | null} */ (form.querySelector("input, select")));
  });
}

/**
 * Why the form could not be sent, in plain words (or null for a bug in our own code).
 * Like explainFailure (modal.js), except for the API's own checks of the fields (422 with
 * a list of errors): their messages are written for developers, and one that a value
 * "should match pattern" even shows the pattern itself, a regular expression. Those get a
 * plain message instead: "Enter a valid email address." for an email field, or which
 * field to check for any other.
 * @param {unknown} error
 * @param {Field[]} fields
 * @returns {string | null}
 */
export function explainFormFailure(error, fields) {
  if (!(error instanceof ApiError) || error.errors.length === 0) return explainFailure(error);
  const messages = error.errors.map((problem) => {
    // The location ends with the field's name: "body.email".
    const field = fields.find((f) => f.name === problem.location.split(".").at(-1));
    if (!/pattern/i.test(problem.message)) return problem.message;
    if (field?.type === "email") return INVALID_EMAIL;
    return field ? `Check ${field.label.toLowerCase()}.` : "Check the values entered.";
  });
  // One line per message; the same message twice is said once.
  return [...new Set(messages)].join(" ");
}

/**
 * One labelled field, kept in step with `values`.
 * @param {Field} field
 * @param {Values} values
 * @param {() => void} rerender builds the fields again (a select changed)
 * @returns {HTMLElement}
 */
function fieldRow(field, values, rerender) {
  const id = `form-dialog-${field.name}`;
  /** @type {HTMLInputElement | HTMLSelectElement} */
  let input;
  if (field.type === "select") {
    const choices =
      typeof field.options === "function" ? field.options(values) : (field.options ?? []);
    // Keep the chosen value only while it is still one of the choices.
    if (!choices.some((choice) => choice.value === values[field.name])) {
      values[field.name] = choices[0]?.value ?? "";
    }
    input = /** @type {HTMLSelectElement} */ (
      el(
        "select",
        { className: "field__input", attrs: { id, name: field.name } },
        choices.map((choice) =>
          el("option", { text: choice.label, attrs: { value: choice.value } }),
        ),
      )
    );
    input.value = values[field.name];
    input.addEventListener("change", () => {
      values[field.name] = input.value;
      rerender();
      document.getElementById(id)?.focus();
    });
  } else {
    input = /** @type {HTMLInputElement} */ (
      el("input", {
        className: "field__input",
        attrs: {
          id,
          name: field.name,
          type: field.type,
          autocomplete: field.autocomplete ?? "off",
        },
      })
    );
    input.value = values[field.name];
    input.addEventListener("input", () => {
      values[field.name] = input.value.trim();
    });
  }
  const children = [
    el("label", { className: "field__label", text: field.label, attrs: { for: id } }),
    input,
  ];
  if (field.hint) children.push(el("span", { className: "field__hint", text: field.hint }));
  return el("div", { className: "field" }, children);
}

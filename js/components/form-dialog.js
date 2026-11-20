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
//
// A "checks" field is a list of checkboxes (what a role grants). Its value is the chosen
// values joined by spaces (permission codes have none). A locked choice is shown but
// cannot be changed: a permission the person lacks stays as it is (rule AZ3).

import { el } from "../core/dom.js";
import { createModal, explainFailure } from "./modal.js";

/**
 * @typedef {{ value: string, label: string, locked?: boolean }} Choice
 * @typedef {Record<string, string>} Values
 * @typedef {{
 *   name: string, label: string, type: "text" | "email" | "select" | "checks",
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
      sending = true;
      modal.setBusy(true);
      try {
        done = { result: await options.run({ ...values }) };
      } catch (error) {
        const message = explainFailure(error);
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
  if (field.type === "checks") return checksRow(field, values);
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

/**
 * A list of checkboxes in a fieldset; the value is the checked values joined by spaces.
 * @param {Field} field
 * @param {Values} values
 * @returns {HTMLElement}
 */
function checksRow(field, values) {
  const choices =
    typeof field.options === "function" ? field.options(values) : (field.options ?? []);
  const chosen = new Set(values[field.name].split(" ").filter(Boolean));
  const boxes = choices.map((choice, index) => {
    const id = `form-dialog-${field.name}-${index}`;
    const box = /** @type {HTMLInputElement} */ (
      el("input", { attrs: { id, type: "checkbox", name: field.name, value: choice.value } })
    );
    box.checked = chosen.has(choice.value);
    box.disabled = Boolean(choice.locked);
    box.addEventListener("change", () => {
      if (box.checked) chosen.add(choice.value);
      else chosen.delete(choice.value);
      values[field.name] = [...chosen].sort().join(" ");
    });
    return el("div", { className: "field__check" }, [
      box,
      el("label", { text: choice.label, attrs: { for: id } }),
    ]);
  });
  const children = [el("legend", { className: "field__label", text: field.label }), ...boxes];
  if (field.hint) children.push(el("span", { className: "field__hint", text: field.hint }));
  return el("fieldset", { className: "field field--checks" }, children);
}

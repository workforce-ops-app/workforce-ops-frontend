// Sign up a company (backend docs/features/organization.md, "Company sign-up").
//
// One public form creates the company and its owner account, and signs the owner in:
// the backend sets the session cookie exactly as at sign-in. So the next page is the
// company's setup (Administration, Structure), where the owner renames General, adds
// departments, and invites people.
//
// What this page checks before sending: every field filled in, an email that looks like
// one, and the password's length and repeat (js/core/password-rules.js). The server
// checks everything again and has the last word: it also refuses common passwords and
// ones containing the company's name or the person's, and its reason is shown as text.

import { ApiError, NetworkError } from "../api/client.js";
import { signUp } from "../api/sessions.js";
import { el, setText } from "../core/dom.js";
import { RULES_TEXT, passwordProblem } from "../core/password-rules.js";

/** Where the new owner goes once signed in: setting up the company's structure. */
export const NEXT_PAGE = "/pages/admin-structure.html";

/**
 * The time zones to offer, and which one to choose first.
 *
 * The browser's own zone is the likely answer (the person is usually at the workplace
 * when signing it up). The list comes from the browser too; a browser that cannot list
 * them gets the common ones, and the server checks the name either way.
 * @param {{ supported?: () => string[], own?: () => string }} [source] replaceable in tests
 * @returns {{ zones: string[], chosen: string }}
 */
export function timeZoneChoices(source = {}) {
  const supported =
    source.supported ??
    (() =>
      typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);
  const own = source.own ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const fallback = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "UTC",
  ];
  const listed = supported();
  const zones = listed.length > 0 ? [...listed] : fallback;
  const browser = own();
  // The browser's zone is always offered, even if the list left it out.
  if (browser && !zones.includes(browser)) zones.unshift(browser);
  return { zones, chosen: browser || zones[0] };
}

/**
 * Explain a failed sign-up in plain words, or null for a bug in our own code.
 * @param {unknown} error
 * @returns {string | null}
 */
export function explain(error) {
  if (error instanceof NetworkError) return "Unable to reach the server. Please try again.";
  if (!(error instanceof ApiError)) return null;
  if (error.status === 429) {
    const wait = error.retryAfter ? ` Try again in ${formatWait(error.retryAfter)}.` : "";
    return `Too many sign-ups from here.${wait}`;
  }
  if (error.status === 409 || error.status === 422) {
    // The server's own reason, written for people: "This email can't be used.", "Sign
    // out first...", or a password rule. Shown as text only. Field problems from the
    // request checks come as a list.
    if (error.errors.length > 0) return error.errors.map((problem) => problem.message).join(" ");
    return error.detail || "Some details cannot be used. Please check them.";
  }
  if (error.status === 403) {
    // The Origin check: the form was not sent from this site's own page.
    return "This form could not be sent. Reload the page and try again.";
  }
  const reference = error.errorId ? ` Reference: ${error.errorId}.` : "";
  return `Something went wrong. Please try again.${reference}`;
}

/**
 * A wait in seconds as people say it: "45 seconds", "12 minutes".
 * @param {number} seconds
 */
export function formatWait(seconds) {
  if (seconds < 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minutes`;
}

/**
 * What is wrong with the form before sending, as the field to point at and the words to
 * show, or null when the page sees nothing wrong.
 * @param {{ company: string, zone: string, name: string, email: string, password: string,
 *   repeat: string, emailLooksValid: boolean }} values
 * @returns {{ field: string, text: string } | null}
 */
export function formProblem(values) {
  if (!values.company) return { field: "company-name", text: "Please enter the company's name." };
  if (!values.zone) return { field: "timezone", text: "Please choose a time zone." };
  if (!values.name) return { field: "display-name", text: "Please enter your name." };
  if (!values.email) return { field: "email", text: "Please enter your email address." };
  if (!values.emailLooksValid) {
    return { field: "email", text: "Please enter a valid email address." };
  }
  const password = passwordProblem(values.password, values.repeat);
  if (password) return { field: "new-password", text: password };
  return null;
}

/**
 * Set up the page: the time zones, the rules, and the form.
 * @param {{ send?: typeof signUp, navigate?: (path: string) => void,
 *   zones?: { zones: string[], chosen: string } }} [options]
 */
export function startSignUp(options = {}) {
  const send = options.send ?? signUp;
  const navigate = options.navigate ?? ((path) => window.location.assign(path));
  const form = document.getElementById("sign-up-form");
  const message = document.getElementById("sign-up-message");
  if (!(form instanceof HTMLFormElement) || !(message instanceof HTMLElement)) {
    throw new Error("The sign-up page is missing required elements.");
  }
  /** @param {string} id */
  const input = (id) => /** @type {HTMLInputElement} */ (form.querySelector(`#${id}`));
  const zone = /** @type {HTMLSelectElement} */ (form.querySelector("#timezone"));
  const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
  const rules = document.getElementById("password-rules");
  if (rules) setText(rules, RULES_TEXT);

  // 1. The time zones, the browser's own chosen. Built with el(): names are text only.
  const { zones, chosen } = options.zones ?? timeZoneChoices();
  zone.replaceChildren(
    ...zones.map((name) =>
      el("option", { text: name.replaceAll("_", " "), attrs: { value: name } }),
    ),
  );
  zone.value = chosen;

  /** Clear the marks a previous attempt left. */
  const clear = () => {
    message.hidden = true;
    form.querySelectorAll("[aria-invalid]").forEach((field) => {
      field.removeAttribute("aria-invalid");
      field.classList.remove("field__input--invalid");
    });
  };
  /** @param {string} text */
  const show = (text) => {
    setText(message, text);
    message.hidden = false;
  };

  // 2. Sending.
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return; // one request at a time
    clear();

    // Names and email lose accidental surrounding spaces; the password is sent exactly
    // as typed, spaces included.
    const email = input("email");
    const values = {
      company: input("company-name").value.trim(),
      zone: zone.value,
      name: input("display-name").value.trim(),
      email: email.value.trim(),
      password: input("new-password").value,
      repeat: input("repeat-password").value,
      emailLooksValid: email.checkValidity(),
    };
    const problem = formProblem(values);
    if (problem) {
      const field = /** @type {HTMLElement} */ (form.querySelector(`#${problem.field}`));
      field.setAttribute("aria-invalid", "true");
      field.classList.add("field__input--invalid");
      show(problem.text);
      field.focus();
      return;
    }

    button.disabled = true;
    setText(button, "Creating company...");
    try {
      await send({
        company_name: values.company,
        timezone: values.zone,
        display_name: values.name,
        email: values.email,
        password: values.password,
      });
    } catch (error) {
      const text = explain(error);
      button.disabled = false;
      setText(button, "Create company");
      if (text === null) throw error; // a bug in our own code: to the console
      show(text);
      return;
    }
    // Signed in as the new owner. The passwords are cleared first, so nothing stays on
    // the page if the browser keeps it for Back.
    input("new-password").value = "";
    input("repeat-password").value = "";
    navigate(NEXT_PAGE);
  });

  // 3. Editing any field clears the message: it may no longer apply.
  form.querySelectorAll("input, select").forEach((field) => {
    field.addEventListener("input", clear);
  });
}

// When the page opens. Returning with Back may bring the page back from the browser's
// cache with the passwords still typed in: they are emptied then, as on the sign-in page.
if (document.getElementById("sign-up-form")) {
  startSignUp();
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    for (const id of ["new-password", "repeat-password"]) {
      const field = document.getElementById(id);
      if (field instanceof HTMLInputElement) field.value = "";
    }
    const button = document.querySelector('#sign-up-form button[type="submit"]');
    if (button instanceof HTMLButtonElement) {
      button.disabled = false;
      setText(button, "Create company");
    }
  });
}

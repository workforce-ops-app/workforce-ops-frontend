// The form for adding a shift, or changing one, in a popup (edit mode of the department
// week, js/components/week-editor.js).
//
// Adding: choose one or more days of the week (the same shift on each), the start and end
// time, who works it (or "Open shift" for nobody yet), and optionally a role, an event,
// and notes. Changing: the same fields for one shift, with a single day.
//
// The form only collects what was typed and hands it to save(); the week editor turns it
// into requests. The form never decides what is allowed: the server checks every value
// again (times, lengths, who may work the shift) and the form shows its answer.
//
// Course topics:
// - XSS: every label, name, and value is put on the page with el() or as an input's value,
//   both plain text. A role like <script> stays those characters.
// - Form validation in two places: the browser checks what it can for convenience (a day
//   chosen, times filled in, maxlength matching the server's limits), the server checks
//   everything for real.

import { el } from "../core/dom.js";
import {
  addDays,
  formatDayHeading,
  formatHours,
  formatTime,
  hoursBetween,
  shiftMoments,
} from "../core/time.js";
import { createModal, explainFailure } from "./modal.js";

/** @typedef {import("../api/shifts.js").EmployeeRef} EmployeeRef */

/**
 * What the form collects. Times are wall-clock "HH:MM" in the workplace's zone; an end at
 * or before the start means the shift ends the next day (an overnight shift).
 * @typedef {{
 *   days: string[], start: string, end: string, employeeId: string | null,
 *   details: string, notes: string, eventName: string, eventDescription: string
 * }} ShiftFormValues
 */

/** The longest shift the server accepts, in hours (the backend's MAX_LENGTH). Only used to
 * warn early; the server refuses longer shifts itself. */
const MAX_HOURS = 12;

/**
 * The line under the times that says when the shift ends, worked out the same way as
 * when it is saved: "Ends the next day, Tuesday, October 6 at 6:00 AM. 8 hours." It makes
 * the overnight rule visible instead of something to remember.
 * @param {string[]} days the chosen days (the first one is described)
 * @param {string} start "HH:MM", or "" when not filled in yet
 * @param {string} end "HH:MM", or ""
 * @param {string} timeZone
 * @returns {{ text: string, warning: boolean }}
 */
export function endSummary(days, start, end, timeZone) {
  if (!start || !end || days.length === 0) return { text: "", warning: false };
  if (start === end) return { text: "A shift must end after it starts.", warning: true };

  const moments = shiftMoments(days[0], start, end, timeZone);
  const hours = hoursBetween(moments.starts_at, moments.ends_at);
  const at = formatTime(moments.ends_at, timeZone);
  const overnight = end <= start;
  const several = days.length > 1;

  let text;
  if (overnight && several) text = `Each shift ends the next day at ${at}.`;
  else if (overnight)
    text = `Ends the next day, ${formatDayHeading(addDays(days[0], 1))} at ${at}.`;
  else text = several ? `Each shift ends the same day at ${at}.` : `Ends the same day at ${at}.`;
  text += ` ${formatHours(hours)}${several ? " each" : ""}.`;

  const tooLong = hours > MAX_HOURS;
  if (tooLong) text += ` That is longer than the ${MAX_HOURS}-hour limit, so it cannot be saved.`;
  return { text, warning: tooLong };
}

/** The value of the "Open shift" choice in the person list. Not a possible user ID. */
const OPEN = "";

/**
 * A labelled field: the label above, an optional hint, then the input.
 * @param {string} label
 * @param {HTMLElement} input it must already have its id
 * @param {string} [hint] a short explanation under the label, linked to the input
 * @returns {HTMLElement}
 */
function field(label, input, hint) {
  const children = [
    el("label", { className: "field__label", text: label, attrs: { for: input.id } }),
  ];
  if (hint) {
    const hintId = `${input.id}-hint`;
    children.push(el("span", { className: "field__hint", text: hint, attrs: { id: hintId } }));
    // Screen readers read the hint together with the field.
    input.setAttribute("aria-describedby", hintId);
  }
  children.push(input);
  return el("div", { className: "field" }, children);
}

/**
 * A text input or text area with a starting value and the server's length limit.
 * @param {"input" | "textarea"} tag
 * @param {string} id
 * @param {string} value
 * @param {number} maxLength the same limit as the backend's (schemas.py)
 * @returns {HTMLInputElement | HTMLTextAreaElement}
 */
function textField(tag, id, value, maxLength) {
  const attrs = /** @type {Record<string, string>} */ ({
    id,
    name: id,
    maxlength: String(maxLength),
  });
  if (tag === "input") attrs.type = "text";
  else attrs.rows = "3";
  const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (
    el(tag, { className: "field__input", attrs })
  );
  // .value sets the text the field holds; it is never parsed as HTML.
  input.value = value;
  return input;
}

/**
 * Open the form, and keep it open until it is saved or the person goes back.
 * @param {{
 *   title: string,
 *   submitLabel: string,
 *   weekDays: string[],
 *   multipleDays: boolean,
 *   people: EmployeeRef[],
 *   timezone: string,
 *   values: ShiftFormValues,
 *   save: (values: ShiftFormValues) => Promise<unknown>,
 * }} options weekDays: the week's seven day keys. multipleDays: day check boxes (adding)
 *   instead of one day to pick (changing). timezone: the workplace's, named in a hint.
 *   save sends the values; if it throws, the reason is shown and the form stays open.
 * @returns {Promise<boolean>} true once saved; false when closed without saving
 */
export function openShiftForm(options) {
  return new Promise((resolve, reject) => {
    let saved = false;
    // True while the values are on their way to the server. Meanwhile the form cannot be
    // left (Go back is off, Escape is held back), since the server may still save them; if
    // the browser closes it anyway, the answer is still waited for (see the submit below).
    let sending = false;
    const modal = createModal({
      className: "edit-dialog",
      labelledBy: "shift-form-title",
      onClose: () => {
        if (!sending) resolve(saved);
      },
    });
    const start = options.values;

    // The days: check boxes when adding (one shift per day ticked), a list when changing.
    /** @type {HTMLInputElement[]} */
    const dayBoxes = [];
    /** @type {HTMLElement} */
    let daysField;
    /** @type {HTMLSelectElement | null} */
    let daySelect = null;
    if (options.multipleDays) {
      const choices = options.weekDays.map((key) => {
        const box = /** @type {HTMLInputElement} */ (
          el("input", {
            attrs: { type: "checkbox", name: "days", value: key, id: `shift-form-day-${key}` },
          })
        );
        box.checked = start.days.includes(key);
        dayBoxes.push(box);
        return el("label", { className: "day-choice", attrs: { for: box.id } }, [
          box,
          formatDayHeading(key),
        ]);
      });
      // A fieldset with a legend: screen readers say "Days, group" before the boxes.
      daysField = el("fieldset", { className: "field day-choices" }, [
        el("legend", { className: "field__label", text: "Days" }),
        el("span", {
          className: "field__hint",
          text: "The same shift is added on each day you tick.",
        }),
        ...choices,
      ]);
    } else {
      daySelect = /** @type {HTMLSelectElement} */ (
        el(
          "select",
          { className: "field__input", attrs: { id: "shift-form-day", name: "day" } },
          options.weekDays.map((key) =>
            el("option", { text: formatDayHeading(key), attrs: { value: key } }),
          ),
        )
      );
      daySelect.value = start.days[0] ?? options.weekDays[0];
      daysField = field("Day", daySelect);
    }

    // Start and end: the browser's own time pickers ("HH:MM", 24-hour values).
    const timeInput = (/** @type {string} */ id, /** @type {string} */ value) => {
      const input = /** @type {HTMLInputElement} */ (
        el("input", {
          className: "field__input",
          attrs: { type: "time", id, name: id, required: "" },
        })
      );
      input.value = value;
      return input;
    };
    const startInput = timeInput("shift-form-start", start.start);
    const endInput = timeInput("shift-form-end", start.end);

    // When the shift ends, updated while the day and times change. aria-live="polite":
    // screen readers read the new line once the person stops typing.
    const summary = el("p", {
      className: "shift-form__summary",
      attrs: { id: "shift-form-summary", "aria-live": "polite" },
    });
    const chosenDays = () =>
      daySelect ? [daySelect.value] : dayBoxes.filter((b) => b.checked).map((b) => b.value);
    const showSummary = () => {
      const { text, warning } = endSummary(
        chosenDays(),
        startInput.value,
        endInput.value,
        options.timezone,
      );
      summary.textContent = text;
      summary.classList.toggle("shift-form__summary--warning", warning);
    };
    for (const input of [startInput, endInput, daySelect, ...dayBoxes]) {
      input?.addEventListener("input", showSummary);
      input?.addEventListener("change", showSummary);
    }
    showSummary();

    // Who works it: "Open shift" first, then the people by name.
    const person = /** @type {HTMLSelectElement} */ (
      el(
        "select",
        { className: "field__input", attrs: { id: "shift-form-person", name: "person" } },
        [
          el("option", { text: "Open shift (nobody yet)", attrs: { value: OPEN } }),
          ...[...options.people]
            .sort((a, b) => a.display_name.localeCompare(b.display_name))
            .map((p) => el("option", { text: p.display_name, attrs: { value: p.id } })),
        ],
      )
    );
    person.value = start.employeeId ?? OPEN;

    // The text fields, with the backend's length limits.
    const details = textField("input", "shift-form-role", start.details, 200);
    const eventName = textField("input", "shift-form-event", start.eventName, 120);
    const eventDescription = textField(
      "textarea",
      "shift-form-event-description",
      start.eventDescription,
      5000,
    );
    const notes = textField("textarea", "shift-form-notes", start.notes, 5000);

    // A form-wide message for anything refused, by the browser checks or by the server.
    const problem = el("p", { className: "form__message", attrs: { role: "alert" } });
    problem.hidden = true;
    /** @param {string} message */
    const showProblem = (message) => {
      problem.textContent = message;
      problem.hidden = false;
    };

    const back = el("button", { className: "button", text: "Go back", attrs: { type: "button" } });
    back.addEventListener("click", () => modal.close());
    const submit = el("button", {
      className: "button button--primary",
      text: options.submitLabel,
      attrs: { type: "submit" },
    });

    const form = /** @type {HTMLFormElement} */ (
      el("form", { className: "form", attrs: { novalidate: "" } }, [
        el("h2", {
          className: "edit-dialog__title",
          text: options.title,
          attrs: { id: "shift-form-title" },
        }),
        problem,
        daysField,
        el("div", { className: "field-row" }, [
          field("Starts", startInput, `Workplace time (${options.timezone})`),
          field("Ends", endInput, "Earlier than the start: ends the next day"),
        ]),
        summary,
        field("Who works it", person),
        field("Role", details, "Optional, e.g. Prep line"),
        field("Event", eventName, "Optional, e.g. Inventory night"),
        field("Event description", eventDescription, "Optional"),
        field("Notes", notes, "Optional, shown to whoever works the shift"),
        el("div", { className: "edit-dialog__buttons" }, [back, submit]),
      ])
    );

    form.addEventListener("submit", async (event) => {
      // The page sends the request itself (AJAX), so the browser must not load a new page.
      event.preventDefault();
      // One request at a time: pressing Enter twice must not add the shift twice.
      if (sending) return;

      const values = {
        days: chosenDays(),
        start: startInput.value,
        end: endInput.value,
        employeeId: person.value === OPEN ? null : person.value,
        details: details.value.trim(),
        notes: notes.value.trim(),
        eventName: eventName.value.trim(),
        eventDescription: eventDescription.value.trim(),
      };

      // The checks the browser can do before asking; the server checks again regardless.
      if (values.days.length === 0) return showProblem("Choose at least one day.");
      if (!values.start || !values.end) return showProblem("Enter a start and an end time.");
      if (values.start === values.end) return showProblem("A shift must end after it starts.");

      sending = true;
      modal.setBusy(true);
      problem.hidden = true;
      /** @type {{ error: unknown } | null} what went wrong, if anything */
      let failure = null;
      try {
        await options.save(values);
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
        // Still open: shown at the top of the form, next to the shift being changed (#16:
        // a 409 is explained in plain words where it happened). Nothing typed is lost.
        if (modal.box.isConnected) {
          showProblem(message);
          problem.scrollIntoView?.({ block: "nearest" });
          return;
        }
      }
      // Saved (close the form), or the browser closed it while sending (report what
      // happened now that the answer is known).
      modal.close();
      resolve(saved);
    });

    modal.box.append(form);
    // Start on the first field.
    modal.open(dayBoxes[0] ?? daySelect);
  });
}

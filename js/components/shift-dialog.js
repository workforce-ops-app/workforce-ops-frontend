// The shift details popup. The schedule screens show each shift as a small button with
// just its time (and who works it, in the department week); clicking it opens this popup
// with everything else: the day, who, the role, the department, the event, and the notes.
// A Close button (or the Escape key) closes it.
//
// It is the browser's own <dialog> element, opened with showModal():
// - the rest of the page cannot be clicked or tabbed to while it is open, and Escape
//   closes it, without any code of ours;
// - it needs no inline script or style, so the Content Security Policy allows it.
// When it closes, keyboard focus goes back to the shift that opened it, so a keyboard user
// carries on where they were.
//
// Every value is written by users (names, roles, notes, event text), so everything goes
// through el(), which only ever sets text: a note with <script> in it is shown as those
// characters and never runs (stored cross-site scripting, threat T5).

import { el } from "../core/dom.js";
import { dayKey, formatDayHeading, formatTimeRange } from "../core/time.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */

/** The one popup of the page, created the first time a shift is opened. */
/** @type {HTMLDialogElement | null} */
let dialog = null;

/** The shift button that opened the popup, to give focus back to on close. */
/** @type {HTMLElement | null} */
let opener = null;

/**
 * The popup element, created once and reused for every shift.
 * @returns {HTMLDialogElement}
 */
function getDialog() {
  if (dialog?.isConnected) return dialog;
  dialog = /** @type {HTMLDialogElement} */ (
    el("dialog", {
      className: "shift-dialog",
      attrs: { "aria-labelledby": "shift-dialog-title" },
    })
  );
  // Back to the shift that opened it, however it was closed (button or Escape).
  dialog.addEventListener("close", () => {
    opener?.focus();
    opener = null;
  });
  document.body.append(dialog);
  return dialog;
}

/**
 * One fact in the popup's list, e.g. "Role: Prep line". Nothing for an empty value.
 * @param {string} label
 * @param {string | null} value
 * @returns {HTMLElement[]}
 */
function fact(label, value) {
  if (!value) return [];
  return [el("dt", { text: label }), el("dd", { text: value })];
}

/**
 * Fill the popup with one shift's details and open it.
 * @param {Shift} shift
 * @param {HTMLElement} [trigger] the element that opened it, which gets focus back on close
 */
export function openShiftDialog(shift, trigger) {
  const box = getDialog();
  opener = trigger ?? null;

  const isOpen = shift.status === "open";
  const close = el("button", {
    className: "button button--primary button--wide",
    text: "Close",
    attrs: { type: "button" },
  });
  close.addEventListener("click", () => closeShiftDialog());

  box.replaceChildren(
    // The day as the heading, the time large underneath: what people look for first.
    el("h2", {
      className: "shift-dialog__title",
      text: formatDayHeading(dayKey(shift.starts_at, shift.timezone)),
      attrs: { id: "shift-dialog-title" },
    }),
    el("p", {
      className: "shift-dialog__time",
      text: formatTimeRange(shift.starts_at, shift.ends_at, shift.timezone),
    }),
    // An open shift says so in words, not only in colour.
    ...(isOpen
      ? [el("p", { className: "shift-dialog__open", text: "Open shift: nobody assigned yet" })]
      : []),
    el("dl", { className: "shift-dialog__facts" }, [
      ...fact("Who", shift.employee?.display_name ?? null),
      ...fact("Role", shift.details),
      ...fact("Department", shift.department.name),
      ...fact(
        "Event",
        shift.event_name
          ? [shift.event_name, shift.event_description].filter(Boolean).join(": ")
          : null,
      ),
      ...fact("Notes", shift.notes),
    ]),
    close,
  );

  // showModal() where the browser has it (every supported browser); a plain open
  // attribute otherwise (the test environment), so the content can still be checked.
  if (typeof box.showModal === "function") {
    box.showModal();
  } else {
    box.setAttribute("open", "");
  }
  // Start on the Close button, so Enter or Space closes the popup straight away.
  close.focus();
}

/** Close the popup (the Close button; Escape is handled by the browser). */
export function closeShiftDialog() {
  if (!dialog) return;
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    // The test environment has no close(): do what it would do.
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  }
}

/**
 * Make an element open a shift's popup when clicked (a click, Enter, or Space on a button).
 * @param {HTMLElement} button
 * @param {Shift} shift
 * @returns {HTMLElement} the same element
 */
export function opensShift(button, shift) {
  // Tells screen readers that this button opens a popup.
  button.setAttribute("aria-haspopup", "dialog");
  button.addEventListener("click", () => openShiftDialog(shift, button));
  return button;
}

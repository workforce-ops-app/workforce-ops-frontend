// Edit mode of the department week (workforce-ops-app/workforce-ops-frontend#16): managers
// add, change, assign, open, and cancel shifts on the week they are looking at, and change
// several selected shifts at once.
//
// How it fits on the page:
// - An "Edit week" button in the page heading switches edit mode on and off. It exists
//   only for people whose session includes schedule.edit.
// - In edit mode, "Add shift" opens the shift form (js/components/shift-form.js), and each
//   shift that can still change gets a select box next to it. Selecting shifts shows a bar
//   at the bottom with what to do with all of them: assign to one person, make open, or
//   cancel. Clicking a shift still opens its details, now with "Change shift" and
//   "Cancel shift" buttons.
// - After every saved change the week loads again from the server, so the screen always
//   shows what was really saved, never a guess.
//
// Course topics:
// - CSRF: every change is a POST or PATCH through js/api/client.js, which adds the
//   X-CSRF-Token header. Another site can make the browser send our cookie, but it cannot
//   read the token, so it cannot forge "cancel all of Kitchen's shifts".
// - Permissions (threat E8): can("schedule.edit") only decides whether the buttons are
//   shown. The server checks schedule.edit and its scope on every request, so someone who
//   turns the buttons on in the browser's developer tools still gets 403, shown here in
//   plain words.
// - Count confirmation (decision 0025, threat D3): a batch of 10 or more shifts first asks
//   "This will change 14 shifts." and then sends confirm_count: 14. The server refuses a
//   large batch without the matching count, so a slip or a script cannot change a whole
//   month by accident.
// - XSS: names, roles, and notes are written by users; everything here goes through el(),
//   which only ever sets text (threat T5).

import {
  batchShifts,
  cancelShift,
  assignShift,
  createShift,
  listShifts,
  updateShift,
} from "../api/shifts.js";
import { el, setText } from "../core/dom.js";
import { can, currentSession } from "../core/session.js";
import {
  addDays,
  dayKey,
  daysLater,
  formatDayHeading,
  formatTimeRange,
  shiftMoments,
  wallTime,
} from "../core/time.js";
import { confirmChange } from "./confirm-dialog.js";
import { explainFailure, PartlySaved } from "./modal.js";
import { closeShiftDialog, setShiftActions } from "./shift-dialog.js";
import { openShiftForm } from "./shift-form.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */
/** @typedef {import("../api/shifts.js").EmployeeRef} EmployeeRef */
/** @typedef {import("./shift-form.js").ShiftFormValues} ShiftFormValues */

/**
 * The week on screen, as the department week page loaded it.
 * @typedef {{
 *   departmentId: string, monday: string, days: string[], shifts: Shift[],
 *   people: EmployeeRef[] | null, today: string,
 * }} WeekContext
 */

/** From this many shifts on, a batch asks first and sends confirm_count (the backend's
 * CONFIRM_AT, decision 0025). */
export const CONFIRM_AT = 10;

/** How many weeks before the shown one to look through for people to offer in the person
 * lists, until the backend's people list exists (workforce-ops-backend#54). */
const HISTORY_WEEKS = 3;

/**
 * Whether a shift can still be changed: not cancelled and not over. The server enforces
 * the same rule (409); checking here only avoids offering buttons that would fail.
 * @param {Shift} shift
 * @param {Date} [now]
 */
export function isChangeable(shift, now = new Date()) {
  return shift.status !== "cancelled" && new Date(shift.ends_at) > now;
}

/**
 * A shift in words, for select boxes and questions: "Monday, October 5, 9:00 AM - 5:00
 * PM, Ana Diaz" (or "open shift"); an overnight shift adds "(ends the next day)".
 * @param {Shift} shift
 */
export function describeShift(shift) {
  const day = formatDayHeading(dayKey(shift.starts_at, shift.timezone));
  const time = formatTimeRange(shift.starts_at, shift.ends_at, shift.timezone);
  // Said in words for an overnight shift, as the "+1 day" marker shows it on screen.
  const overnight = daysLater(shift.starts_at, shift.ends_at, shift.timezone) > 0;
  const who = shift.employee ? shift.employee.display_name : "open shift";
  return `${day}, ${time}${overnight ? " (ends the next day)" : ""}, ${who}`;
}

// Also exported from here for the tests; it lives in js/core/time.js so the shift form
// can show the end it works out.
export { shiftMoments };

/**
 * Everyone who appears in the lists, once each: the department's people when the server
 * gave them, plus whoever worked a shift in the department lately.
 * @param {EmployeeRef[] | null} people
 * @param {Shift[][]} shiftLists
 * @returns {EmployeeRef[]}
 */
export function peopleFrom(people, ...shiftLists) {
  /** @type {Map<string, EmployeeRef>} */
  const byId = new Map();
  for (const person of people ?? []) byId.set(person.id, person);
  for (const shifts of shiftLists) {
    for (const shift of shifts) {
      if (shift.employee && !byId.has(shift.employee.id))
        byId.set(shift.employee.id, shift.employee);
    }
  }
  return [...byId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/**
 * The text fields of the form as the API wants them: empty means none (null).
 * @param {ShiftFormValues} values
 */
function textFields(values) {
  return {
    details: values.details || null,
    notes: values.notes || null,
    event_name: values.eventName || null,
    event_description: values.eventDescription || null,
  };
}

/**
 * Switch on edit mode for the department week, if the signed-in person may edit.
 *
 * Expects #edit-tools (in the page heading), #batch-bar (under the week), and <main>.
 * Returns update(), which the page calls with the week each time one has loaded (or with
 * null while loading, or when no week could be shown).
 *
 * @param {{ reload: () => Promise<unknown> }} options reload: load the week again (the
 *   page's own loading, so it waits its turn behind a week change in progress)
 * @returns {{ update: (context: WeekContext | null) => void }}
 */
export function weekEditor(options) {
  const tools = document.getElementById("edit-tools");
  const bar = document.getElementById("batch-bar");
  const main = document.querySelector("main");
  // Without schedule.edit nothing is set up at all: no button, no select boxes. (The
  // server would refuse every change anyway; this only keeps the page simple.)
  if (!tools || !bar || !main || !can("schedule.edit")) {
    return { update: () => {} };
  }
  // The same element, known to exist from here on (for the functions below).
  const page = main;

  let editing = false;
  /** @type {WeekContext | null} */
  let context = null;
  /** @type {Set<string>} the IDs of the selected shifts */
  const selected = new Set();
  // The bar's state, kept here rather than in its elements: the bar is drawn again
  // whenever something changes (a box ticked, more people found in the background), and
  // a refusal or the chosen person must survive that.
  /** Why the last change of the selection was refused ("" when it was not). */
  let barProblem = "";
  /** The person chosen in the bar's list. */
  let barPerson = "";
  /** True while a change of the selection is being sent: the bar's buttons are off, so
   * quick clicks cannot send the same (or a conflicting) change twice. */
  let barBusy = false;
  /** @type {EmployeeRef[]} the people offered in the person lists */
  let people = [];
  /** The department those people belong to. */
  let peopleDepartment = "";
  /** The week whose recent shifts were looked through for people ("dept|monday"). */
  let historyFor = "";

  // --- The tools in the page heading --------------------------------------------------

  const toggle = el("button", {
    className: "button edit-toggle",
    text: "Edit week",
    attrs: { type: "button", "aria-pressed": "false" },
  });
  const add = el("button", {
    className: "button button--primary",
    text: "Add shift",
    attrs: { type: "button" },
  });
  add.hidden = true;
  // Says what just happened ("Shift added."), read out by screen readers (role="status").
  const message = el("p", { className: "edit-message", attrs: { role: "status" } });

  tools.replaceChildren(toggle, add, message);
  tools.hidden = false;

  toggle.addEventListener("click", () => {
    editing = !editing;
    toggle.setAttribute("aria-pressed", String(editing));
    setText(toggle, editing ? "Done editing" : "Edit week");
    add.hidden = !editing;
    main.classList.toggle("schedule--editing", editing);
    setText(message, "");
    selected.clear();
    barProblem = "";
    if (editing) {
      decorate();
      void loadPeople();
    } else {
      undecorate();
    }
    renderBar();
  });

  add.addEventListener("click", () => void addShift());

  // The details popup gets edit buttons while edit mode is on.
  setShiftActions((shift) => (editing && context ? shiftActions(shift) : []));

  /** @param {string} text */
  function announce(text) {
    setText(message, text);
  }

  // --- The week on screen -------------------------------------------------------------

  /** @param {WeekContext | null} next */
  function update(next) {
    context = next;
    // A new week (or the same one again after a change): start with nothing selected.
    selected.clear();
    barProblem = "";
    add.toggleAttribute("disabled", context === null);
    if (context) {
      // Keep the people found earlier while staying in the same department; start over in
      // another one, so a person list never mixes departments.
      const sameDepartment = peopleDepartment === context.departmentId;
      peopleDepartment = context.departmentId;
      if (!sameDepartment) historyFor = "";
      people = peopleFrom(
        [...(context.people ?? []), ...(sameDepartment ? people : [])],
        context.shifts,
      );
      if (editing) {
        decorate();
        void loadPeople();
      }
    }
    renderBar();
  }

  /**
   * Look through the department's last few weeks for people to offer, once per week
   * shown. Until the backend lists a department's people (workforce-ops-backend#54), the
   * people who worked there lately are the best list the page can make; the server still
   * checks that whoever is chosen may work the shift (422 otherwise, shown in the form).
   */
  async function loadPeople() {
    if (!context) return;
    const key = `${context.departmentId}|${context.monday}`;
    if (historyFor === key) return;
    historyFor = key;
    const { departmentId, monday, shifts } = context;
    try {
      const recent = await listShifts({
        from: addDays(monday, -7 * HISTORY_WEEKS),
        to: addDays(monday, 6),
        departmentId,
      });
      // Only if the person has not moved to another department meanwhile.
      if (peopleDepartment === departmentId) {
        people = peopleFrom(people, shifts, recent);
        renderBar();
      }
    } catch {
      // Only a shorter list: the week's own people are still offered.
      historyFor = "";
    }
  }

  /** Put a select box next to every shift that can still change. */
  function decorate() {
    if (!context) return;
    const byId = new Map(context.shifts.map((s) => [s.id, s]));
    for (const button of page.querySelectorAll("[data-shift-id]")) {
      if (
        !(button instanceof HTMLElement) ||
        button.parentElement?.classList.contains("shift-pick")
      ) {
        continue;
      }
      const shift = byId.get(button.dataset.shiftId ?? "");
      if (!shift || !isChangeable(shift)) continue;

      const box = /** @type {HTMLInputElement} */ (
        el("input", {
          className: "shift-pick__box",
          // The label says which shift, since the box sits apart from the shift's text.
          attrs: {
            type: "checkbox",
            "aria-label": `Select ${describeShift(shift)}`,
            "data-pick": shift.id,
          },
        })
      );
      box.checked = selected.has(shift.id);
      box.addEventListener("change", () => select(shift.id, box.checked));

      const wrapper = el("span", { className: "shift-pick" });
      button.replaceWith(wrapper);
      wrapper.append(box, button);
    }
  }

  /** Take the select boxes away again (edit mode switched off). */
  function undecorate() {
    for (const wrapper of page.querySelectorAll(".shift-pick")) {
      const button = wrapper.querySelector("[data-shift-id]");
      if (button) wrapper.replaceWith(button);
    }
  }

  /**
   * Select or unselect a shift. The same shift has a box in the grid and in the day cards
   * (only one is visible at a time), so both are kept in step.
   * @param {string} id
   * @param {boolean} on
   */
  function select(id, on) {
    // A new selection: the refusal was about the old one.
    barProblem = "";
    if (on) selected.add(id);
    else selected.delete(id);
    // Compared in code rather than built into a selector, so an ID never becomes part of
    // a query string.
    for (const box of page.querySelectorAll("input[data-pick]")) {
      if (box instanceof HTMLInputElement && box.dataset.pick === id) box.checked = on;
    }
    renderBar();
  }

  // --- The bar for selected shifts ----------------------------------------------------

  function renderBar() {
    if (!bar) return;
    if (!editing || !context || selected.size === 0) {
      bar.hidden = true;
      bar.replaceChildren();
      return;
    }
    const count = selected.size;

    const problem = el("p", {
      className: "form__message",
      text: barProblem,
      attrs: { role: "alert" },
    });
    problem.hidden = barProblem === "";

    const person = /** @type {HTMLSelectElement} */ (
      el(
        "select",
        {
          className: "field__input batch-bar__person",
          attrs: { id: "batch-person", name: "batch-person" },
        },
        people.map((p) => el("option", { text: p.display_name, attrs: { value: p.id } })),
      )
    );
    const assign = el("button", {
      className: "button button--primary",
      text: "Assign",
      attrs: { type: "button" },
    });
    if (people.some((p) => p.id === barPerson)) person.value = barPerson;
    person.addEventListener("change", () => {
      barPerson = person.value;
    });
    assign.toggleAttribute("disabled", people.length === 0);
    const open = el("button", {
      className: "button",
      text: "Make open",
      attrs: { type: "button" },
    });
    const cancel = el("button", {
      className: "button button--danger-outline",
      text: count === 1 ? "Cancel shift" : "Cancel shifts",
      attrs: { type: "button" },
    });
    const clear = el("button", {
      className: "button button--quiet",
      text: "Clear selection",
      attrs: { type: "button" },
    });

    assign.addEventListener("click", () => {
      const name = person.selectedOptions[0]?.textContent ?? "";
      void oneAtATime(() =>
        runBatch({ action: "assign", employee_id: person.value }, `Assign to ${name}`),
      );
    });
    open.addEventListener(
      "click",
      () => void oneAtATime(() => runBatch({ action: "assign", employee_id: null }, "Make open")),
    );
    cancel.addEventListener("click", () => void oneAtATime(cancelSelected));
    clear.addEventListener("click", () => {
      for (const id of [...selected]) select(id, false);
    });

    // Everything in the bar is off while a change is on its way (barBusy).
    for (const control of [person, assign, open, cancel, clear]) {
      if (barBusy) control.setAttribute("disabled", "");
    }
    bar.toggleAttribute("aria-busy", barBusy);

    bar.replaceChildren(
      el("p", {
        className: "batch-bar__count",
        text: `${count} ${count === 1 ? "shift" : "shifts"} selected`,
      }),
      el("div", { className: "batch-bar__actions" }, [
        el("label", {
          className: "visually-hidden",
          text: "Assign the selected shifts to",
          attrs: { for: "batch-person" },
        }),
        person,
        assign,
        open,
        cancel,
        clear,
      ]),
      problem,
    );
    bar.hidden = false;
  }

  /**
   * Run one change of the selection, unless one is already running. The buttons are
   * switched off too, but a second click can arrive before the bar is drawn again, so the
   * flag is checked here as well. It stays on until the week has loaded again, so nothing
   * is sent for shifts the screen no longer shows correctly.
   * @param {() => Promise<void>} change
   */
  async function oneAtATime(change) {
    if (barBusy) return;
    barBusy = true;
    renderBar();
    try {
      await change();
    } finally {
      barBusy = false;
      renderBar();
    }
  }

  /**
   * Assign the selected shifts to one person, or make them open, all or nothing. From 10
   * shifts on, ask first and send the count (decision 0025).
   * @param {{ action: "assign", employee_id: string | null }} change
   * @param {string} label what the confirm button says
   */
  async function runBatch(change, label) {
    const ids = [...selected];
    const count = ids.length;
    const send = () =>
      batchShifts({
        ...change,
        shift_ids: ids,
        ...(count >= CONFIRM_AT ? { confirm_count: count } : {}),
      });

    if (count >= CONFIRM_AT) {
      const done = await confirmChange({
        title: "Confirm batch change",
        message: `This will change ${count} shifts.`,
        confirmLabel: `${label}: ${count} shifts`,
        run: send,
      });
      if (done) await saved(`${count} shifts changed.`);
      return;
    }
    try {
      await send();
      await saved(count === 1 ? "1 shift changed." : `${count} shifts changed.`);
    } catch (error) {
      const text = explainFailure(error);
      if (text === null) throw error;
      // Next to the shifts it is about: in the bar for the selection.
      barProblem = text;
      renderBar();
    }
  }

  /** Cancel the selected shifts, always after asking (a cancelled shift cannot come back). */
  async function cancelSelected() {
    const ids = [...selected];
    const count = ids.length;
    const done = await confirmChange({
      title: count === 1 ? "Cancel this shift?" : `Cancel ${count} shifts?`,
      message:
        (count >= CONFIRM_AT ? `This will change ${count} shifts. ` : "") +
        "Cancelled shifts leave the week and cannot be changed again.",
      confirmLabel: count === 1 ? "Cancel shift" : `Cancel ${count} shifts`,
      run: () =>
        batchShifts({
          action: "cancel",
          shift_ids: ids,
          ...(count >= CONFIRM_AT ? { confirm_count: count } : {}),
        }),
    });
    if (done) await saved(count === 1 ? "1 shift cancelled." : `${count} shifts cancelled.`);
  }

  /**
   * After a saved change: say so, and load the week again from the server.
   * @param {string} text
   */
  async function saved(text) {
    selected.clear();
    barProblem = "";
    renderBar();
    await options.reload();
    announce(text);
  }

  // --- One shift: add, change, cancel -------------------------------------------------

  /** The workplace zone for a new shift: the week's shifts', else the company's. */
  function timeZone() {
    return (
      context?.shifts[0]?.timezone ??
      currentSession()?.company.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  }

  async function addShift() {
    if (!context) return;
    const { departmentId, days, today } = context;
    const zone = timeZone();
    // How many shifts the form added, for the confirmation ("3 shifts added.").
    let added = 0;
    const done = await openShiftForm({
      title: "Add a shift",
      submitLabel: "Add shift",
      weekDays: days,
      multipleDays: true,
      people,
      timezone: zone,
      values: {
        // Today when it is in this week, else Monday.
        days: [days.includes(today) ? today : days[0]],
        start: "09:00",
        end: "17:00",
        employeeId: null,
        details: "",
        notes: "",
        eventName: "",
        eventDescription: "",
      },
      save: async (values) => {
        const times = values.days.map((day) => shiftMoments(day, values.start, values.end, zone));
        added = times.length;
        if (times.length === 1) {
          await createShift({
            department_id: departmentId,
            employee_id: values.employeeId,
            ...times[0],
            ...textFields(values),
          });
        } else {
          // Several days: one batch, so either every day's shift is added or none is.
          await batchShifts({
            action: "create",
            department_id: departmentId,
            employee_id: values.employeeId,
            times,
            ...textFields(values),
            ...(times.length >= CONFIRM_AT ? { confirm_count: times.length } : {}),
          });
        }
      },
    });
    if (done) await saved(added === 1 ? "Shift added." : `${added} shifts added.`);
  }

  /**
   * The buttons edit mode adds to a shift's details popup.
   * @param {Shift} shift
   * @returns {HTMLElement[]}
   */
  function shiftActions(shift) {
    if (!isChangeable(shift)) {
      return [
        el("p", {
          className: "edit-dialog__note",
          text: "This shift has ended, so it can no longer be changed.",
        }),
      ];
    }
    const change = el("button", {
      className: "button",
      text: "Change shift",
      attrs: { type: "button" },
    });
    const cancel = el("button", {
      className: "button button--danger-outline",
      text: "Cancel shift",
      attrs: { type: "button" },
    });
    change.addEventListener("click", () => {
      closeShiftDialog();
      void changeShift(shift);
    });
    cancel.addEventListener("click", () => {
      closeShiftDialog();
      void cancelOne(shift);
    });
    return [
      el("div", { className: "edit-dialog__buttons shift-dialog__actions" }, [change, cancel]),
    ];
  }

  /**
   * Change one shift: its times and text with PATCH, who works it with assign.
   * @param {Shift} shift
   */
  async function changeShift(shift) {
    if (!context) return;
    const zone = shift.timezone;
    /** @type {ShiftFormValues} */
    const before = {
      days: [dayKey(shift.starts_at, zone)],
      start: wallTime(shift.starts_at, zone),
      end: wallTime(shift.ends_at, zone),
      employeeId: shift.employee?.id ?? null,
      details: shift.details ?? "",
      notes: shift.notes ?? "",
      eventName: shift.event_name ?? "",
      eventDescription: shift.event_description ?? "",
    };
    const weekDays = context.days.includes(before.days[0])
      ? context.days
      : [before.days[0], ...context.days];
    const done = await openShiftForm({
      title: "Change shift",
      submitLabel: "Save changes",
      weekDays,
      multipleDays: false,
      people: peopleFrom(people, [shift]),
      timezone: zone,
      values: before,
      save: async (values) => {
        // Only what changed is sent, so the audit log lists exactly the fields changed.
        /** @type {import("../api/shifts.js").ShiftChanges} */
        const changes = {};
        const timesChanged =
          values.days[0] !== before.days[0] ||
          values.start !== before.start ||
          values.end !== before.end;
        if (timesChanged)
          Object.assign(changes, shiftMoments(values.days[0], values.start, values.end, zone));
        const text = textFields(values);
        const old = textFields(before);
        for (const key of /** @type {(keyof typeof text)[]} */ (Object.keys(text))) {
          if (text[key] !== old[key]) changes[key] = text[key];
        }
        const patched = Object.keys(changes).length > 0;
        if (patched) await updateShift(shift.id, changes);
        if (values.employeeId === before.employeeId) return;

        try {
          await assignShift(shift.id, values.employeeId);
        } catch (error) {
          if (!patched) throw error;
          // The times and text are saved, but who works it is not: two requests, and the
          // server has no single one for both (the person changes only through assign).
          // So the form says exactly that, and stays open to try the person again.
          // From now on the saved values are the starting point, so trying again sends
          // only the assignment, not the same PATCH twice.
          Object.assign(before, { ...values, employeeId: before.employeeId });
          // The week behind the form shows the saved part right away, so it is right even
          // if the person goes back instead of trying again.
          void options.reload();
          throw new PartlySaved(
            "The times and details were saved, but who works the shift was not changed.",
            error,
          );
        }
      },
    });
    if (done) await saved("Shift saved.");
  }

  /**
   * Cancel one shift, after asking.
   * @param {Shift} shift
   */
  async function cancelOne(shift) {
    const done = await confirmChange({
      title: "Cancel this shift?",
      message: `${describeShift(shift)}. A cancelled shift leaves the week and cannot be changed again.`,
      confirmLabel: "Cancel shift",
      run: () => cancelShift(shift.id),
    });
    if (done) await saved("Shift cancelled.");
  }

  return { update };
}

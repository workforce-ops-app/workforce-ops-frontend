// The coworker's card on the home screen (docs/features/coverage.md): a time-off request
// still collecting offers, with each shift the person could take, their own answer so far,
// and the buttons to cover it, swap it for one of their own shifts, or decline.
//
// Only the builders live here; js/pages/my-shifts.js loads the data. Every name and API
// message goes on the page as text with el(), never as HTML (threat T5). The card never
// shows why the time off was asked for: that may be medical or personal, so the API does
// not send the reason to coworkers at all (threat I10), and the card has no place for it. The API
// checks every rule again (who may offer, overlaps, the swap shift), and a refusal (409)
// is shown in place, under the shift it is about.

import { ApiError, NetworkError } from "../api/client.js";
import { answerOffer, withdrawOffer } from "../api/time-off.js";
import { el, setText } from "../core/dom.js";
import { dayKey } from "../core/time.js";
import { answerText, dayRange, shiftWhen } from "../core/time-off-words.js";

/** @typedef {import("../api/time-off.js").Offerable} Offerable */
/** @typedef {import("../api/time-off.js").AffectedShift} AffectedShift */
/** @typedef {import("../api/shifts.js").Shift} Shift */

/**
 * The coworker's own shifts they could give for a swap of this shift: scheduled, not
 * started, in the same department, and outside the requested days (the API's rule; the
 * API also checks the person asking could work it).
 * @param {AffectedShift} wanted the requested shift
 * @param {Shift[]} mine the coworker's own shifts
 * @param {{ first_day: string, last_day: string }} request
 * @param {Date} now
 */
export function swapChoices(wanted, mine, request, now) {
  return mine.filter((shift) => {
    if (shift.status !== "scheduled" || new Date(shift.starts_at) <= now) return false;
    if (shift.department.id !== wanted.department_id) return false;
    // Outside the time off: its day (in its own zone) is not one of the requested days.
    const day = dayKey(new Date(shift.starts_at), shift.timezone);
    return day < request.first_day || day > request.last_day;
  });
}

/**
 * What a failed answer says, in place: the API's own words for a refusal.
 * @param {unknown} error
 */
function problemText(error) {
  if (error instanceof ApiError) return error.detail || error.title;
  if (error instanceof NetworkError) return "The server could not be reached.";
  throw error; // a bug, not a refusal: let it show
}

/**
 * One coworker's card.
 * @param {Offerable} item
 * @param {{ zone: string, myShifts: Shift[], now: Date, onChange: () => Promise<void> }} options
 *   zone: the workplace's time zone; myShifts: the person's own upcoming shifts (for swaps);
 *   onChange: reload the cards after an answer
 * @returns {HTMLElement}
 */
export function offerCard(item, options) {
  const { request } = item;
  return el("li", { className: "offer-card" }, [
    el("p", {
      className: "offer-card__title",
      text: `${request.employee_name} asked for time off: ${dayRange(request.first_day, request.last_day)}`,
    }),
    el(
      "ul",
      { className: "offer-card__shifts" },
      item.shifts.map((shift) => shiftRow(item, shift, options)),
    ),
  ]);
}

/**
 * One shift of the request: when it is, the person's answer, and the buttons.
 * @param {Offerable} item
 * @param {AffectedShift} shift
 * @param {{ zone: string, myShifts: Shift[], now: Date, onChange: () => Promise<void> }} options
 */
function shiftRow(item, shift, options) {
  const requestId = item.request.id;
  const mine = item.answers.find((offer) => offer.shift_id === shift.id);
  const problem = el("p", { className: "form__message", attrs: { role: "alert" } });
  problem.hidden = true;

  /**
   * Send one answer (or take it back), then reload; a refusal shows under this shift.
   * @param {() => Promise<unknown>} call
   */
  async function send(call) {
    problem.hidden = true;
    try {
      await call();
      await options.onChange();
    } catch (error) {
      setText(problem, problemText(error));
      problem.hidden = false;
    }
  }

  // Step 1: the swap choices, as a select of the person's own shifts.
  const choices = swapChoices(shift, options.myShifts, item.request, options.now);
  const label = `Your shift to give for ${shiftWhen(shift, options.zone)}`;
  const select = /** @type {HTMLSelectElement} */ (
    el(
      "select",
      { className: "field__input", attrs: { "aria-label": label } },
      choices.map((given) =>
        el("option", {
          text: `${shiftWhen(given, given.timezone)}, ${given.department.name}`,
          attrs: { value: given.id },
        }),
      ),
    )
  );

  /**
   * @param {string} text
   * @param {() => Promise<unknown>} call
   * @param {string} [className]
   */
  const button = (text, call, className = "button") => {
    const made = el("button", { className, text, attrs: { type: "button" } });
    made.addEventListener("click", () => send(call));
    return made;
  };

  const buttons = [
    button("Cover", () => answerOffer(requestId, shift.id, "cover"), "button button--primary"),
    ...(choices.length
      ? [select, button("Swap", () => answerOffer(requestId, shift.id, "swap", select.value))]
      : []),
    button("Decline", () => answerOffer(requestId, shift.id, "decline")),
    ...(mine ? [button("Take back", () => withdrawOffer(requestId, shift.id))] : []),
  ];

  return el("li", { className: "offer-card__shift" }, [
    el("p", { className: "offer-card__when", text: shiftWhen(shift, options.zone) }),
    el("p", {
      className: "muted",
      text: mine ? `${answerText(mine, options.zone, true)}.` : "You have not answered.",
    }),
    el("div", { className: "offer-card__actions" }, buttons),
    problem,
  ]);
}

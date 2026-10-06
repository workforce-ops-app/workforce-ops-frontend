// Small summary tiles at the top of a page, e.g. "Open shifts: 2". A label and a large
// number, so a manager sees the state of the week before reading the details.

import { el } from "../core/dom.js";

/**
 * One tile.
 * @param {string} label what the number counts, e.g. "Open shifts"
 * @param {string | number} value
 * @param {{ attention?: boolean }} [options] attention: amber, for something that needs
 *   action (open shifts); the label says what it is, so colour is never the only sign
 * @returns {HTMLElement}
 */
export function statTile(label, value, options = {}) {
  return el("div", { className: options.attention ? "stat stat--attention" : "stat" }, [
    el("p", { className: "stat__label", text: label }),
    el("p", { className: "stat__value", text: value }),
  ]);
}

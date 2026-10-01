// Safe helpers for putting data on the page. They only ever set text, never HTML.
//
// Why: assigning data to innerHTML lets the browser treat it as HTML, so a name like
// <img src=x onerror="..."> would run its script (cross-site scripting, threat model T5).
// Every page builds its content with these helpers instead, and lint forbids innerHTML.

/**
 * @typedef {{ text?: string | number | null, className?: string, attrs?: Record<string, string> }} ElOptions
 */

/**
 * Create an element with optional text, class, attributes, and children.
 * @param {string} tag
 * @param {ElOptions} [options]
 * @param {Array<Node | string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, options = {}, children = []) {
  const element = document.createElement(tag);

  // Text always goes through setText, so it is shown as text and never parsed as HTML.
  if (options.text !== undefined) {
    setText(element, options.text);
  }

  if (options.className) {
    element.className = options.className;
  }

  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      // Event-handler attributes (onclick, onerror, ...) contain code the browser runs.
      // Lowercase first, because attribute names are case-insensitive (ONERROR works too).
      if (key.toLowerCase().startsWith("on")) {
        throw new Error("Refused attribute: " + key);
      }
      // A "javascript:" URL runs code when a link is followed or a source is loaded.
      // The pattern allows leading spaces and any capitalization, the usual ways to sneak
      // past a simple check: ^ start, \s* optional spaces, i = ignore case.
      if (typeof value === "string" && /^\s*javascript:/i.test(value)) {
        throw new Error("Refused attribute: " + key);
      }
      // Anything else is safe to set: setAttribute stores the value as plain text.
      element.setAttribute(key, value);
    }
  }

  for (const child of children) {
    // Strings become text nodes, so a string child containing HTML stays harmless text.
    if (typeof child === "string") {
      element.appendChild(document.createTextNode(child));
    } else {
      element.appendChild(child);
    }
  }

  return element;
}

/**
 * Show a value as text inside an element, replacing what was there.
 * @param {Element} element
 * @param {string | number | null | undefined} value
 */
export function setText(element, value) {
  // textContent replaces everything inside with plain text: "<script>" shows up as those
  // characters and never runs. `== null` (two equals signs) is true for both null and
  // undefined, so a missing value shows nothing instead of the word "undefined".
  element.textContent = value == null ? "" : String(value);
}

/**
 * Remove everything inside an element.
 * @param {Element} element
 */
export function clear(element) {
  // Replacing the children with nothing leaves the element empty.
  element.replaceChildren();
}

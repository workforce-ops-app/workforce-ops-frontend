// The text of an announcement (its title or its body), built safely: the one place that
// turns what a manager typed into something on the screen. Used by the announcement cards
// (js/components/announcement-card.js) and, later, by the preview while posting (AN5).
//
// The rules (backend announcements design, "Text"):
// - The only formatting is bold: a pair of ** marks, **like this**, is shown in bold.
// - Anything else is shown exactly as typed. A lone ** with no partner stays "**", and an
//   empty pair (****) stays "****", since there is nothing to make bold.
// - Line breaks are kept. They stay newline characters inside text nodes; the stylesheet
//   (.announcement-text, white-space: pre-line) shows each one as a new line.
// - The text is never HTML. Announcements reach everyone in their audience, so a script in
//   one would run for every reader (stored cross-site scripting, threat T5). That is why:
//     - the bold parts are <strong> elements made with el(), whose text is set with
//       textContent, so "<script>" inside them is shown as those characters;
//     - everything else becomes text nodes (document.createTextNode), which the browser
//       never parses;
//     - innerHTML, outerHTML, and insertAdjacentHTML are never used (lint refuses them).
//   No element other than <strong> is ever created, whatever the text contains.
//
// How pairs are found, step by step: look for the first "**", then for the next "**" after
// it. The text between them is the bold part. Carry on after the closing mark. When no
// closing mark is left, the rest (including a last lone "**") is plain text. So
// "a **b** c **d" becomes "a ", bold "b", " c **d". Three or more stars in a row are read
// the same way, two at a time from the left: "***x***" becomes bold "*x" followed by "*".

import { el } from "../core/dom.js";

/** The mark that opens and closes a bold part. */
const MARK = "**";

/**
 * @typedef {{ bold: boolean, text: string }} TextPart one run of text, bold or not
 */

/**
 * Split announcement text into plain and bold runs, without touching the page. Kept apart
 * from the DOM so the rules can be tested on their own (and reused by a preview).
 * @param {string | null | undefined} value the title or body as the API sent it
 * @returns {TextPart[]} the runs in order; neighbouring plain runs are joined into one
 */
export function boldParts(value) {
  // A missing value shows nothing, like setText does.
  if (value == null) return [];

  // Windows line endings (\r\n) and old Mac ones (\r) become plain \n, so every line
  // break looks the same on screen.
  const text = String(value).replace(/\r\n?/g, "\n");

  /** @type {TextPart[]} */
  const parts = [];
  // Plain text collected so far, not yet added to parts.
  let plain = "";
  // Where in the text the search goes on from.
  let position = 0;

  for (;;) {
    // The next opening mark, and the closing mark after it.
    const open = text.indexOf(MARK, position);
    if (open === -1) break;
    const close = text.indexOf(MARK, open + MARK.length);
    // No partner: this "**" (and everything after it) stays as typed.
    if (close === -1) break;

    const inner = text.slice(open + MARK.length, close);
    if (inner === "") {
      // An empty pair ("****") has nothing to make bold, so it is kept as typed.
      plain += text.slice(position, close + MARK.length);
    } else {
      // The text before the pair is plain; the text inside it is bold.
      plain += text.slice(position, open);
      if (plain) parts.push({ bold: false, text: plain });
      plain = "";
      parts.push({ bold: true, text: inner });
    }
    position = close + MARK.length;
  }

  // Whatever is left after the last pair is plain text.
  plain += text.slice(position);
  if (plain) parts.push({ bold: false, text: plain });
  return parts;
}

/**
 * The nodes that show announcement text: text nodes, and <strong> elements for the bold
 * parts. Append them to an element with the class "announcement-text" (which keeps the
 * line breaks), for example el("p", { className: "announcement-text" }, announcementText(body)).
 * @param {string | null | undefined} value the title or body as the API sent it
 * @returns {Node[]}
 */
export function announcementText(value) {
  return boldParts(value).map((part) =>
    part.bold
      ? // el() sets the text with textContent: the bold part is never parsed as HTML.
        el("strong", { text: part.text })
      : // A text node is only ever text, whatever characters it holds.
        document.createTextNode(part.text),
  );
}

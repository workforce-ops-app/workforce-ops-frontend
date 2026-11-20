// One announcement in a list: the announcements page and the home screen (slice AN4).
//
// What it shows, top to bottom:
// - the title, inside a button that opens and closes the message (a disclosure: the
//   button says aria-expanded="true" or "false", and aria-controls names the message);
// - an "Unread" label in front of the title while the person has not opened it yet. It is
//   a word, not only a colour, so screen readers hear it as part of the button's name;
// - a line with who posted it, who it is for, when (in the workplace's time zone), and
//   "Edited" when the text was corrected after posting;
// - the message itself, hidden until the button opens it.
//
// Opening an unread announcement marks it read: a POST to the server (with the CSRF token,
// js/api/announcements.js), and once the server has said yes the "Unread" label goes. If
// the request fails, the label stays and the next opening tries again; the message is
// shown either way, since reading it does not depend on the mark.
//
// The title and the message are written by managers, so they go through
// announcementText() (js/components/announcement-text.js), which makes **bold** pairs
// <strong> elements and everything else text nodes. Names go through el(), which only sets
// text. Nothing here is ever parsed as HTML (stored cross-site scripting, threat T5).

import { ApiError, NetworkError } from "../api/client.js";
import { markAnnouncementRead } from "../api/announcements.js";
import { el } from "../core/dom.js";
import { currentSession } from "../core/session.js";
import { formatMoment } from "../core/time.js";
import { announcementText } from "./announcement-text.js";
import { icon } from "./shift-card.js";

/** @typedef {import("../api/announcements.js").Announcement} Announcement */

/** Counts the cards made on this page, so each message gets an ID of its own. */
let cardCount = 0;

/**
 * The time zone announcements are shown in: the company's (workplace) zone from the
 * loaded session, as for shifts (decision 0021), so everyone sees the same posting time.
 * Before the session has loaded (or when it could not be), the browser's own zone.
 * @returns {string}
 */
export function workplaceTimeZone() {
  return currentSession()?.company.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Who an announcement is for, in words, e.g. "Kitchen department" or "Everyone".
 * @param {import("../api/announcements.js").Audience} audience
 * @returns {string}
 */
export function audienceLabel(audience) {
  if (audience.type === "department") return `${audience.department_name ?? "A"} department`;
  if (audience.type === "team") return `${audience.team_name ?? "A"} team`;
  // The whole company.
  return "Everyone";
}

/**
 * The card for one announcement.
 * @param {Announcement} announcement
 * @param {{ timeZone: string, headingLevel?: 2 | 3 }} options timeZone: the workplace's
 *   zone, for the posting time; headingLevel: h2 on the announcements page (under its
 *   h1), h3 on the home screen (under the section's h2), so headings always nest
 * @returns {HTMLElement}
 */
export function announcementCard(announcement, options) {
  // Whether this person has read it. Starts with what the server said; becomes true once
  // the server has accepted the read mark.
  let read = announcement.read;
  // True while the read mark is on its way, so a quick second click sends nothing more.
  let sending = false;

  // The message, hidden until the button opens it. Its ID ties it to the button.
  const bodyId = `announcement-body-${++cardCount}`;
  const body = el(
    "div",
    { className: "announcement__body announcement-text", attrs: { id: bodyId } },
    announcementText(announcement.body),
  );
  body.hidden = true;

  // "Unread" in front of the title, while it is unread.
  const unread = el("span", { className: "announcement__unread", text: "Unread" });

  // The button: the label, the title (with its bold parts), and a chevron that turns when
  // the message is open (css/components/announcement.css).
  const toggle = el(
    "button",
    {
      className: "announcement__toggle",
      attrs: { type: "button", "aria-expanded": "false", "aria-controls": bodyId },
    },
    [
      ...(read ? [] : [unread]),
      el(
        "span",
        { className: "announcement__title announcement-text" },
        announcementText(announcement.title),
      ),
      icon("chevron-right"),
    ],
  );

  // The facts line: "From Ana Diaz · To Kitchen department · Mon, Oct 5, 2026, 9:00 AM",
  // and "· Edited" when it was corrected. The time sits in a <time> element with the exact
  // moment, so it is machine-readable as well.
  const facts = [
    el("span", { text: `From ${announcement.author?.display_name ?? "someone"}` }),
    el("span", { text: `To ${audienceLabel(announcement.audience)}` }),
    el("time", {
      text: formatMoment(announcement.posted_at, options.timeZone),
      attrs: { datetime: announcement.posted_at },
    }),
  ];
  if (announcement.edited_at) {
    facts.push(el("span", { className: "announcement__edited", text: "Edited" }));
  }
  // Separators between the facts; aria-hidden, since screen readers pause between the
  // parts anyway and would otherwise read out "dot".
  const meta = el(
    "p",
    { className: "announcement__meta" },
    facts.flatMap((fact, index) =>
      index === 0
        ? [fact]
        : [
            el("span", {
              className: "announcement__dot",
              text: " · ",
              attrs: { "aria-hidden": "true" },
            }),
            fact,
          ],
    ),
  );

  const card = el(
    "article",
    { className: read ? "announcement" : "announcement announcement--unread" },
    [
      // The title is a real heading, so screen-reader users can jump from one announcement
      // to the next; the button sits inside it (the usual disclosure pattern).
      el(`h${options.headingLevel ?? 2}`, { className: "announcement__heading" }, [toggle]),
      meta,
      body,
    ],
  );

  /** Send the read mark once, and drop the "Unread" label when the server has it. */
  async function markRead() {
    if (read || sending) return;
    sending = true;
    try {
      await markAnnouncementRead(announcement.id);
      read = true;
      unread.remove();
      card.classList.remove("announcement--unread");
    } catch (error) {
      // The server could not be reached, or refused (for example 404 when the person is
      // no longer in its audience): it stays marked unread, and the next opening tries
      // again. Anything else is a bug in our own code, thrown on to the console.
      if (!(error instanceof ApiError || error instanceof NetworkError)) throw error;
    } finally {
      sending = false;
    }
  }

  toggle.addEventListener("click", () => {
    // Open when closed, close when open.
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
    // Opening it is reading it.
    if (open) void markRead();
  });

  return card;
}

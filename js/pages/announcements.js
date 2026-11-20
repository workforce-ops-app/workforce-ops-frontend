// Announcements: every announcement meant for the signed-in person, newest first, a page
// at a time (frontend docs, features/announcements.md). Unread ones say "Unread"; opening
// one shows its message and marks it read (js/components/announcement-card.js).
//
// The list comes in pages (decision 0026): the first page loads with the page, and
// "Load more announcements" asks for the next one with the cursor the server gave, until
// the server says there is no more (next_cursor null). Pages are only loaded when the
// person asks, so a company with years of announcements never sends them all at once.

import { ApiError, NetworkError } from "../api/client.js";
import { listAnnouncements } from "../api/announcements.js";
import { announcementCard, workplaceTimeZone } from "../components/announcement-card.js";
import { startSignedInPage } from "../components/app-shell.js";
import { el, setText } from "../core/dom.js";

/** How many announcements each page of the list holds. */
export const PAGE_SIZE = 20;

/**
 * A plain-language problem line for the status spot. Returns false for a bug in our own
 * code, which the caller throws on, so it is never mistaken for a network problem.
 * @param {HTMLElement} status
 * @param {unknown} error
 * @returns {boolean}
 */
function showProblem(status, error) {
  if (error instanceof ApiError || error instanceof NetworkError) {
    const message = error instanceof ApiError ? error.title : "the server could not be reached";
    status.replaceChildren(el("span", { className: "error", text: `Problem: ${message}` }));
    return true;
  }
  status.replaceChildren(
    el("span", { className: "error", text: "Problem: this page could not load" }),
  );
  return false;
}

/**
 * Load the first page of announcements and set up "Load more".
 * Exported for the tests; the page calls it once the session has loaded.
 */
export async function showAnnouncements() {
  const status = document.getElementById("status");
  const list = document.getElementById("announcements");
  const more = document.getElementById("load-more");
  if (!status || !list || !(more instanceof HTMLButtonElement)) return;

  const timeZone = workplaceTimeZone();
  /** @type {string | null} where the next page starts, from the server */
  let cursor = null;

  /**
   * Ask for one page and add its announcements to the end of the list.
   * @returns {Promise<HTMLElement[]>} the cards added
   */
  const loadPage = async () => {
    const page = await listAnnouncements({ cursor, limit: PAGE_SIZE });
    cursor = page.next_cursor;
    // One list item per announcement, so screen readers can say how many there are.
    const cards = page.items.map((item) => announcementCard(item, { timeZone, headingLevel: 2 }));
    list.append(...cards.map((card) => el("li", { className: "announcement-list__item" }, [card])));
    // "Load more" only while the server has more.
    more.hidden = cursor === null;
    return cards;
  };

  // The first page.
  try {
    await loadPage();
  } catch (error) {
    more.hidden = true;
    if (showProblem(status, error)) return;
    throw error;
  }
  setText(status, list.childElementCount === 0 ? "No announcements yet." : "");

  // Each click asks for the next page. The button is off while it loads, so one click
  // sends one request.
  more.addEventListener("click", async () => {
    if (more.disabled) return;
    more.disabled = true;
    setText(more, "Loading…");
    setText(status, "");
    try {
      const cards = await loadPage();
      // Keyboard focus moves to the first new announcement, so a keyboard or screen-reader
      // user carries on reading where the new ones start (the button may now be gone).
      cards[0]?.querySelector("button")?.focus();
    } catch (error) {
      // The list so far stays; the button stays too, so the person can try again.
      if (!showProblem(status, error)) throw error;
    } finally {
      more.disabled = false;
      setText(more, "Load more announcements");
    }
  });
}

// Once the session has loaded (signed-out visitors go to the sign-in page instead), show
// the announcements.
startSignedInPage(showAnnouncements);

// Moving between weeks without loading the whole page again (docs/architecture/components.md).
//
// The Previous and Next buttons are ordinary links (?week=YYYY-MM-DD), so they still work
// when opened in a new tab, bookmarked, or shared. A plain click, though, is handled here:
// the address changes with history.pushState, and only the week is fetched again in the
// background (AJAX). The frame (brand, tabs, the signed-in person's name) and the session
// already in memory stay as they are, so nothing on the page disappears and comes back.
//
// While the new week loads, the page's <main> is marked aria-busy="true": screen readers
// know it is changing, and css/components/week-nav.css dims the old week a moment later
// (not at once, so a quick answer causes no flicker at all).

/**
 * Whether the browser should handle a click itself: a click that opens a new tab or
 * window (Ctrl, Cmd, Shift, a middle click), or one another script already handled.
 * @param {MouseEvent} event
 */
function leaveToBrowser(event) {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * Make the #previous-week, #current-week, and #next-week links, and the browser's Back
 * and Forward buttons, change the week in place.
 *
 * Weeks load one at a time. Clicking Next three times quickly does not start three
 * requests that could answer in any order (and leave an older week on screen): the clicks
 * during a load only remember the latest address, which loads as soon as the current one
 * is done. The week shown therefore always matches the address.
 *
 * @param {(search: string) => Promise<void>} showWeek the page's own loading, e.g. showMyWeek
 * @returns {(search: string) => Promise<void>} load a week by its query string (for the tests)
 */
export function followWeekLinks(showWeek) {
  const main = document.querySelector("main");
  // The address to show next (null: the screen is up to date), and the load in progress.
  /** @type {string | null} */
  let wanted = null;
  /** @type {Promise<void> | null} */
  let running = null;

  /** @param {string} search */
  function load(search) {
    wanted = search;
    if (running) return running;

    running = (async () => {
      main?.setAttribute("aria-busy", "true");
      try {
        // Keep going while clicks arrived during the last load; only the latest counts.
        while (wanted !== null) {
          const next = wanted;
          wanted = null;
          await showWeek(next);
        }
      } finally {
        main?.removeAttribute("aria-busy");
        running = null;
      }
    })();
    return running;
  }

  for (const id of ["previous-week", "current-week", "next-week"]) {
    document.getElementById(id)?.addEventListener("click", (event) => {
      const link = event.currentTarget;
      if (!(link instanceof HTMLAnchorElement) || leaveToBrowser(event)) return;
      if (link.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
        return;
      }
      // Only another week of this same page is handled here; anything else is left to an
      // ordinary page load. (The links are built by core/week.js, so this always holds.)
      const target = new URL(link.href);
      if (target.origin !== window.location.origin) return;
      if (target.pathname !== window.location.pathname) return;

      event.preventDefault();
      // A new history entry, so Back returns to the week before, and the address can still
      // be bookmarked or shared.
      window.history.pushState(null, "", target);
      // A bug in our own code is thrown on by the page and reaches the console from here.
      void load(target.search);
    });
  }

  // Back and Forward between weeks: the address has already changed, so show its week.
  window.addEventListener("popstate", () => void load(window.location.search));

  return load;
}

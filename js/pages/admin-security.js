// Security: the requests in this company whose input looked like an attack (slice DT7;
// docs/features/security.md). Detection only records; nothing was blocked.
//
// At the top, how many of each type in the last 7 and 30 days; under it, the events
// themselves, newest first, a page at a time, with filters by type, person, and days.
//
// Who sees it: people with security.view (Owner and Administrator). The link is shown only
// to them, and the API refuses everyone else (403), which the page then says; hiding the
// link is a convenience, not the protection (E8).
//
// Every event carries attacker text (the excerpt, and the field and route it came in on),
// so every value here goes on the page with el(), which sets textContent only. Nothing is
// ever parsed as HTML, so an excerpt such as <img src=x onerror=alert(1)> shows as those
// characters and runs nothing (threat T7).

import { ApiError, NetworkError } from "../api/client.js";
import { listSecurityEvents, securitySummary } from "../api/security.js";
import { listPeople } from "../api/users.js";
import { workplaceTimeZone } from "../components/announcement-card.js";
import { startSignedInPage } from "../components/app-shell.js";
import { el, setText } from "../core/dom.js";
import { can } from "../core/session.js";
import { formatMoment } from "../core/time.js";

/** @typedef {import("../api/security.js").SecurityEvent} SecurityEvent */
/** @typedef {import("../api/security.js").KindCount} KindCount */

/** How many events each page of the list holds. */
export const PAGE_SIZE = 50;

/**
 * The kinds the API knows, in the order the page lists them, with their names in words
 * (backend detection.md, "Attack types").
 */
export const KINDS = /** @type {const} */ ([
  ["detection.sql_injection", "SQL injection"],
  ["detection.xss", "Cross-site scripting"],
  ["detection.path_traversal", "Path traversal"],
  ["detection.command_injection", "Command injection"],
  ["detection.format_string", "Format string or template"],
  // Refused requests (backend #92, detection.md "Refused requests"): what the server
  // refused, with nothing the sender typed, so they have no pattern and no excerpt.
  ["authz.denied", "Refused: no permission"],
  ["tenancy.not_found", "Refused: another company's record"],
  ["request.not_found", "Refused: not found"],
  ["csrf.refused", "Refused: forged request"],
  ["auth.reauth_failed", "Refused: wrong password re-entered"],
  ["auth.reauth_locked", "Refused: too many wrong passwords"],
  ["detection.summary", "Held back by the rate cap"],
  ["audit.chain_broken", "Audit log check failed"],
]);

/** The refused-request kinds: no pattern or excerpt, and the field is a permission. */
const REFUSAL_KINDS = new Set([
  "authz.denied",
  "tenancy.not_found",
  "request.not_found",
  "csrf.refused",
  "auth.reauth_failed",
  "auth.reauth_locked",
]);

/**
 * A kind in words; an unknown one (a newer server) as its code, so nothing is hidden.
 * @param {string} kind
 * @returns {string}
 */
export function kindLabel(kind) {
  return KINDS.find(([code]) => code === kind)?.[1] ?? kind;
}

/**
 * The summary in the page's order: the known kinds first, then any others the server
 * sends, each with its counts (zero when the server left one out).
 * @param {KindCount[]} counts
 * @returns {KindCount[]}
 */
export function orderedCounts(counts) {
  const known = KINDS.map(
    ([kind]) =>
      counts.find((count) => count.kind === kind) ?? { kind, last_7_days: 0, last_30_days: 0 },
  );
  const others = counts.filter((count) => !KINDS.some(([kind]) => kind === count.kind));
  return [...known, ...others];
}

/**
 * The summary as a table: one row per type, the 7 and 30 day counts in columns. A type
 * with events in the last 7 days is marked, in words as well as colour.
 * @param {KindCount[]} counts
 * @returns {HTMLElement}
 */
export function summaryTable(counts) {
  return el("table", { className: "security-summary" }, [
    el("caption", { className: "visually-hidden", text: "Events per type" }),
    el("thead", {}, [
      el("tr", {}, [
        el("th", { text: "Type", attrs: { scope: "col" } }),
        el("th", { text: "Last 7 days", attrs: { scope: "col" } }),
        el("th", { text: "Last 30 days", attrs: { scope: "col" } }),
      ]),
    ]),
    el(
      "tbody",
      {},
      orderedCounts(counts).map((count) =>
        el("tr", { className: count.last_7_days > 0 ? "security-summary__recent" : "" }, [
          el("th", { text: kindLabel(count.kind), attrs: { scope: "row" } }),
          el("td", { text: String(count.last_7_days) }),
          el("td", { text: String(count.last_30_days) }),
        ]),
      ),
    ),
  ]);
}

/**
 * One fact of an event: its name, then its value ("None" when there is none).
 * @param {string} name
 * @param {string | null | undefined} value
 * @param {string} [className] e.g. for the excerpt's monospace look
 * @returns {HTMLElement[]}
 */
function fact(name, value, className) {
  return [
    el("dt", { text: name }),
    // Set as text: the value may be attacker text (T7).
    el("dd", { className: className ?? "", text: value || "None" }),
  ];
}

/**
 * One event as a card: when and what at the top, then where it came in, who sent it, from
 * which address, and the excerpt.
 * @param {SecurityEvent} event
 * @param {string} timeZone the company's, for the time
 * @returns {HTMLElement}
 */
export function eventCard(event, timeZone) {
  const summary = event.kind === "detection.summary";
  // A refusal holds only what the server decided: its field is the permission refused.
  const refusal = REFUSAL_KINDS.has(event.kind);
  const facts = [
    // A summary row stands for the events the rate cap held back, not one request.
    ...(summary
      ? fact("Events held back", String(event.count))
      : refusal
        ? []
        : fact("Pattern", event.pattern_id)),
    ...(refusal ? fact("Permission", event.field) : fact("Field", event.field)),
    ...fact("Route", [event.method, event.route].filter(Boolean).join(" ")),
    ...fact("Person", event.user_name ?? (event.user_id ? "Unknown person" : "Not signed in")),
    ...fact("Address", event.client_address),
    ...(summary || refusal ? [] : fact("Excerpt", event.excerpt, "security-event__excerpt")),
  ];
  return el("article", { className: "security-event" }, [
    el("h3", { className: "security-event__title" }, [
      el("span", { text: kindLabel(event.kind) }),
      el("time", {
        className: "security-event__when",
        text: formatMoment(event.occurred_at, timeZone),
        attrs: { datetime: event.occurred_at },
      }),
    ]),
    el("dl", { className: "security-event__facts" }, facts),
  ]);
}

/**
 * The filters as the form holds them now, ready for the API (empty ones are left out).
 * @param {HTMLFormElement} form
 * @returns {{ kind: string, userId: string, from: string, to: string }}
 */
export function readFilters(form) {
  const data = new FormData(form);
  const text = (/** @type {string} */ name) => String(data.get(name) ?? "");
  return { kind: text("kind"), userId: text("person"), from: text("from"), to: text("to") };
}

/**
 * Whether the days make sense: "to" not before "from" (both optional). Checked here so a
 * slip gets a plain sentence before any request; the server checks again (422).
 * @param {{ from: string, to: string }} filters
 * @returns {string | null} the problem in words, or null
 */
export function daysProblem(filters) {
  if (filters.from && filters.to && filters.to < filters.from) {
    return "The last day is before the first day.";
  }
  return null;
}

/**
 * Put a problem in a status line: the two failures a page expects in plain words (the
 * server's 403 included, for someone without security.view); returns false for anything
 * else (a bug in our own code), which the caller throws on.
 * @param {HTMLElement} status
 * @param {unknown} error
 * @returns {boolean}
 */
function showProblem(status, error) {
  if (error instanceof ApiError && error.status === 403) {
    status.replaceChildren(
      el("span", { className: "error", text: "You do not have access to security events." }),
    );
    return true;
  }
  if (error instanceof ApiError || error instanceof NetworkError) {
    const message =
      error instanceof ApiError ? error.detail || error.title : "the server could not be reached";
    status.replaceChildren(el("span", { className: "error", text: `Problem: ${message}` }));
    return true;
  }
  status.replaceChildren(
    el("span", { className: "error", text: "Problem: this page could not load" }),
  );
  return false;
}

/**
 * Fill the type and person filters. The people come from the people list when the
 * session may list them (user.view); otherwise the person filter is left out.
 * @param {HTMLSelectElement} kindSelect
 * @param {HTMLSelectElement} personSelect
 */
async function fillFilters(kindSelect, personSelect) {
  kindSelect.append(
    el("option", { text: "All types", attrs: { value: "" } }),
    ...KINDS.map(([code, label]) => el("option", { text: label, attrs: { value: code } })),
  );
  personSelect.append(el("option", { text: "Everyone", attrs: { value: "" } }));
  const row = personSelect.closest(".field");
  if (!can("user.view")) {
    if (row instanceof HTMLElement) row.hidden = true;
    return;
  }
  try {
    const people = await listPeople();
    personSelect.append(
      ...[...people]
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
        .map((person) => el("option", { text: person.display_name, attrs: { value: person.id } })),
    );
  } catch (error) {
    // The list of people is a convenience for the filter: without it, the events still show.
    if (!(error instanceof ApiError || error instanceof NetworkError)) throw error;
    if (row instanceof HTMLElement) row.hidden = true;
  }
}

/**
 * Load the summary, the filters, and the first page of events, and set up filtering and
 * "Load more". Exported for the tests; the page calls it once the session has loaded.
 */
export async function showSecurity() {
  const summarySpot = document.getElementById("summary");
  const summaryStatus = document.getElementById("summary-status");
  const status = document.getElementById("status");
  const list = document.getElementById("events");
  const more = document.getElementById("load-more");
  const form = document.getElementById("filters");
  const kindSelect = document.getElementById("filter-kind");
  const personSelect = document.getElementById("filter-person");
  if (
    !summarySpot ||
    !summaryStatus ||
    !status ||
    !list ||
    !(more instanceof HTMLButtonElement) ||
    !(form instanceof HTMLFormElement) ||
    !(kindSelect instanceof HTMLSelectElement) ||
    !(personSelect instanceof HTMLSelectElement)
  ) {
    return;
  }
  const timeZone = workplaceTimeZone();
  /** @type {string | null} where the next page starts, from the server */
  let cursor = null;
  // The filters of the list on screen, so "Load more" continues the same list.
  let filters = readFilters(form);
  // Counts the loads, so an older answer arriving late never adds to a newer list.
  let generation = 0;

  /** Ask for one page with the current filters and add its events to the list. */
  const loadPage = async () => {
    const asked = generation;
    const page = await listSecurityEvents({ ...filters, cursor, limit: PAGE_SIZE });
    if (asked !== generation) return;
    cursor = page.next_cursor;
    list.append(
      ...page.items.map((event) =>
        el("li", { className: "security-list__item" }, [eventCard(event, timeZone)]),
      ),
    );
    more.hidden = cursor === null;
  };

  /** Start the list again from the newest, with the filters in the form. */
  const reload = async () => {
    generation += 1;
    cursor = null;
    filters = readFilters(form);
    list.replaceChildren();
    more.hidden = true;
    const problem = daysProblem(filters);
    if (problem) {
      status.replaceChildren(el("span", { className: "error", text: problem }));
      return;
    }
    setText(status, "Loading events…");
    try {
      await loadPage();
      setText(status, list.childElementCount === 0 ? "No events match these filters." : "");
    } catch (error) {
      if (!showProblem(status, error)) throw error;
    }
  };

  /** The counts at the top. */
  const showSummary = async () => {
    try {
      summarySpot.replaceChildren(summaryTable(await securitySummary()));
      setText(summaryStatus, "");
    } catch (error) {
      if (!showProblem(summaryStatus, error)) throw error;
    }
  };

  // The counts, the filters' choices, and the first page, all at once.
  await Promise.all([showSummary(), fillFilters(kindSelect, personSelect), reload()]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void reload();
  });
  more.addEventListener("click", async () => {
    if (more.disabled) return;
    more.disabled = true;
    setText(more, "Loading…");
    try {
      await loadPage();
    } catch (error) {
      if (!showProblem(status, error)) throw error;
    } finally {
      more.disabled = false;
      setText(more, "Load more events");
    }
  });
}

// Once the session has loaded (signed-out visitors go to the sign-in page instead).
startSignedInPage(showSecurity);

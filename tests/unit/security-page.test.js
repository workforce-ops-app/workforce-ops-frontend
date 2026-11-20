// The security page (slice DT7): the counts table, the event cards, the filters and their
// requests, paging, and the empty, error, and no-access states. Every event value is
// attacker text, so it must reach the page as text and never as HTML (threat T7).
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../js/api/client.js";
import { loadPage } from "./page-html.js";

// Replace the data sources, so each test decides what the "server" returns.
vi.mock("../../js/api/security.js", () => ({
  listSecurityEvents: vi.fn(),
  securitySummary: vi.fn(),
}));
vi.mock("../../js/api/users.js", () => ({ listPeople: vi.fn() }));
// The time zone and the permissions come from the session.
vi.mock("../../js/core/session.js", () => ({
  currentSession: () => ({ company: { timezone: "America/Chicago" } }),
  can: vi.fn(),
}));
// The page starts through the frame (session first); here each test calls the page's own
// loading directly.
vi.mock("../../js/components/app-shell.js", () => ({ startSignedInPage: vi.fn() }));

const api = await import("../../js/api/security.js");
const { listPeople } = await import("../../js/api/users.js");
const { can } = await import("../../js/core/session.js");
const page = await import("../../js/pages/admin-security.js");

/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);

/** Text that would run a script if it were ever put on the page as HTML. */
const XSS = "<img src=x onerror=alert(1)>";

/**
 * One event as the API sends it.
 * @param {string} id
 * @param {Partial<import("../../js/api/security.js").SecurityEvent>} [extra]
 * @returns {import("../../js/api/security.js").SecurityEvent}
 */
function event(id, extra = {}) {
  return {
    id,
    kind: "detection.xss",
    pattern_id: "XSS-02",
    field: "body.notes",
    method: "POST",
    route: "/api/shifts",
    user_id: "u4",
    user_name: "Ben Okafor",
    client_address: "203.0.113.10",
    request_id: "r1",
    excerpt: XSS,
    count: 1,
    occurred_at: "2026-10-05T14:00:00Z",
    ...extra,
  };
}

/** Let pending requests and their follow-ups settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (/** @type {string} */ id) => document.getElementById(id)?.textContent?.trim();
const cards = () => [...document.querySelectorAll("#events article")];

/**
 * Load the real page with these answers.
 * @param {{ events?: unknown, counts?: unknown, permissions?: string[] }} [answers]
 */
async function show(answers = {}) {
  loadPage("admin-security.html");
  const permissions = answers.permissions ?? ["security.view", "user.view"];
  asMock(can).mockImplementation((code) => permissions.includes(code));
  asMock(listPeople).mockResolvedValue([
    { id: "u9", display_name: "Zoe" },
    { id: "u4", display_name: "Ben Okafor" },
  ]);
  const counts = answers.counts ?? [{ kind: "detection.xss", last_7_days: 2, last_30_days: 5 }];
  if (counts instanceof Error) asMock(api.securitySummary).mockRejectedValue(counts);
  else asMock(api.securitySummary).mockResolvedValue(counts);
  const events = answers.events ?? { items: [event("e1")], next_cursor: null };
  if (events instanceof Error) asMock(api.listSecurityEvents).mockRejectedValue(events);
  else asMock(api.listSecurityEvents).mockResolvedValue(events);
  await page.showSecurity();
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("the counts", () => {
  it("list every known type in order, zero for the ones the server left out", () => {
    const ordered = page.orderedCounts([
      { kind: "detection.format_string", last_7_days: 1, last_30_days: 1 },
      { kind: "something.new", last_7_days: 4, last_30_days: 4 },
    ]);
    expect(ordered.map((c) => c.kind)).toEqual([...page.KINDS.map(([k]) => k), "something.new"]);
    expect(ordered[0]).toEqual({
      kind: "detection.sql_injection",
      last_7_days: 0,
      last_30_days: 0,
    });
  });

  it("name each type in words, an unknown one by its code", () => {
    expect(page.kindLabel("detection.sql_injection")).toBe("SQL injection");
    expect(page.kindLabel("something.new")).toBe("something.new");
  });

  it("show as a table with row and column headers, recent types marked", () => {
    const table = page.summaryTable([{ kind: "detection.xss", last_7_days: 2, last_30_days: 5 }]);
    const row = [...table.querySelectorAll("tbody tr")].find((r) =>
      r.textContent?.startsWith("Cross-site scripting"),
    );
    expect([...(row?.children ?? [])].map((c) => c.textContent)).toEqual([
      "Cross-site scripting",
      "2",
      "5",
    ]);
    expect(row?.className).toBe("security-summary__recent");
    expect(row?.querySelector("th")?.getAttribute("scope")).toBe("row");
  });
});

describe("an event card", () => {
  it("shows every value as text, the excerpt included (T7)", () => {
    const card = page.eventCard(
      event("e1", { field: `body.${XSS}`, route: `/api/${XSS}`, user_name: `Ben ${XSS}` }),
      "America/Chicago",
    );
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector(".security-event__excerpt")?.textContent).toBe(XSS);
    expect(card.textContent).toContain(`body.${XSS}`);
    expect(card.textContent).toContain(`POST /api/${XSS}`);
    expect(card.textContent).toContain(`Ben ${XSS}`);
    // Every element is one the card builds itself.
    const tags = new Set([...card.querySelectorAll("*")].map((e) => e.tagName));
    expect([...tags].sort()).toEqual(["DD", "DL", "DT", "H3", "SPAN", "TIME"]);
  });

  it("says when, in the company's time zone", () => {
    const card = page.eventCard(event("e1"), "America/Chicago");
    expect(card.querySelector("time")?.textContent).toBe("Mon, Oct 5, 2026, 9:00 AM");
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-05T14:00:00Z");
  });

  it("shows a rate-cap summary as how many were held back, without a pattern or excerpt", () => {
    const card = page.eventCard(
      event("e2", { kind: "detection.summary", pattern_id: null, excerpt: null, count: 5 }),
      "America/Chicago",
    );
    const facts = [...card.querySelectorAll("dt")].map((d) => d.textContent);
    expect(facts).toEqual(["Events held back", "Field", "Route", "Person", "Address"]);
    expect(card.querySelector("dd")?.textContent).toBe("5");
  });

  it("says None for a missing value and Not signed in without a person", () => {
    const card = page.eventCard(
      event("e3", { client_address: null, user_id: null, user_name: null }),
      "America/Chicago",
    );
    const value = (/** @type {string} */ name) =>
      [...card.querySelectorAll("dt")].find((d) => d.textContent === name)?.nextElementSibling
        ?.textContent;
    expect(value("Address")).toBe("None");
    expect(value("Person")).toBe("Not signed in");
  });
});

describe("the days filter", () => {
  it("refuses a last day before the first, and allows either alone", () => {
    expect(page.daysProblem({ from: "2026-10-05", to: "2026-10-01" })).toBe(
      "The last day is before the first day.",
    );
    expect(page.daysProblem({ from: "2026-10-05", to: "" })).toBeNull();
    expect(page.daysProblem({ from: "2026-10-01", to: "2026-10-05" })).toBeNull();
  });
});

describe("the page", () => {
  it("shows the counts and the first page of events", async () => {
    await show();
    expect(document.querySelectorAll("#summary tbody tr")).toHaveLength(page.KINDS.length);
    expect(cards()).toHaveLength(1);
    expect(document.querySelector("#events img")).toBeNull();
    expect(api.listSecurityEvents).toHaveBeenCalledWith({
      kind: "",
      userId: "",
      from: "",
      to: "",
      cursor: null,
      limit: page.PAGE_SIZE,
    });
  });

  it("offers every type and the company's people, by name", async () => {
    await show();
    const options = (/** @type {string} */ id) =>
      [...document.querySelectorAll(`#${id} option`)].map((o) => o.textContent);
    expect(options("filter-kind")).toEqual(["All types", ...page.KINDS.map(([, label]) => label)]);
    expect(options("filter-person")).toEqual(["Everyone", "Ben Okafor", "Zoe"]);
  });

  it("leaves out the person filter without user.view", async () => {
    await show({ permissions: ["security.view"] });
    expect(listPeople).not.toHaveBeenCalled();
    const row = document.getElementById("filter-person")?.closest(".field");
    expect(/** @type {HTMLElement} */ (row).hidden).toBe(true);
  });

  it("asks again with the chosen filters, from the newest", async () => {
    await show();
    /** @type {HTMLSelectElement} */ (document.getElementById("filter-kind")).value =
      "detection.sql_injection";
    /** @type {HTMLSelectElement} */ (document.getElementById("filter-person")).value = "u4";
    /** @type {HTMLInputElement} */ (document.getElementById("filter-from")).value = "2026-10-01";
    /** @type {HTMLFormElement} */ (document.getElementById("filters")).requestSubmit();
    await settle();
    expect(api.listSecurityEvents).toHaveBeenLastCalledWith({
      kind: "detection.sql_injection",
      userId: "u4",
      from: "2026-10-01",
      to: "",
      cursor: null,
      limit: page.PAGE_SIZE,
    });
  });

  it("sends nothing for days the wrong way round, and says why", async () => {
    await show();
    asMock(api.listSecurityEvents).mockClear();
    /** @type {HTMLInputElement} */ (document.getElementById("filter-from")).value = "2026-10-05";
    /** @type {HTMLInputElement} */ (document.getElementById("filter-to")).value = "2026-10-01";
    /** @type {HTMLFormElement} */ (document.getElementById("filters")).requestSubmit();
    await settle();
    expect(api.listSecurityEvents).not.toHaveBeenCalled();
    expect(text("status")).toBe("The last day is before the first day.");
  });

  it("loads the next page with the server's cursor and the same filters", async () => {
    await show({ events: { items: [event("e1")], next_cursor: "e1" } });
    const more = /** @type {HTMLButtonElement} */ (document.getElementById("load-more"));
    expect(more.hidden).toBe(false);
    asMock(api.listSecurityEvents).mockResolvedValue({ items: [event("e0")], next_cursor: null });
    more.click();
    await settle();
    expect(api.listSecurityEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "e1", limit: page.PAGE_SIZE }),
    );
    expect(cards()).toHaveLength(2);
    expect(more.hidden).toBe(true);
  });

  it("says when nothing matches", async () => {
    await show({ events: { items: [], next_cursor: null } });
    expect(text("status")).toBe("No events match these filters.");
  });

  it("says plainly when the person has no access", async () => {
    const refused = new ApiError(403, { title: "Forbidden" });
    await show({ events: refused, counts: refused });
    expect(text("status")).toBe("You do not have access to security events.");
    expect(text("summary-status")).toBe("You do not have access to security events.");
    expect(cards()).toHaveLength(0);
  });

  it("shows the server's reason for refused filters", async () => {
    await show({
      events: new ApiError(422, { title: "Unprocessable", detail: "Unknown kind." }),
    });
    expect(text("status")).toBe("Problem: Unknown kind.");
  });
});

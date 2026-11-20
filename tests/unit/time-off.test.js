// My time off: statuses in plain words, which requests can be cancelled, the day checks
// before sending, the API calls, and the page itself (form limits, preview, the list).
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPage } from "./page-html.js";

vi.mock("../../js/components/app-shell.js", () => ({ startSignedInPage: vi.fn() }));
vi.mock("../../js/core/session.js", () => ({
  can: () => true,
  currentSession: () => ({
    user: { id: "ana", display_name: "Ana", email: "a@x", department_id: "d1" },
    company: { id: "c", name: "Northwind", timezone: "America/Chicago" },
    permissions: [],
  }),
}));
const { canCancel, dayRange, daysIn, daysProblem, showTimeOff, statusText } =
  await import("../../js/pages/time-off.js");
const { askForTimeOff, cancelTimeOff, myRequests } = await import("../../js/api/time-off.js");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** @returns {import("../../js/api/time-off.js").TimeOff} */
function request(overrides = {}) {
  return {
    id: "t1",
    employee_id: "ana",
    employee_name: "Ana",
    first_day: "2026-11-23",
    last_day: "2026-11-27",
    reason: null,
    status: "pending",
    not_reviewed: false,
    created_at: "2026-11-19T16:00:00Z",
    decided_at: null,
    ...overrides,
  };
}

/**
 * Answer each request by its address.
 * @param {(url: string, init: RequestInit) => unknown} reply
 */
function serve(reply) {
  const fetchMock = vi.fn().mockImplementation((url, init) =>
    Promise.resolve(
      new Response(JSON.stringify(reply(String(url), init ?? {})), {
        status: init?.method === "POST" ? 201 : 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the rules", () => {
  it("says each status in plain words", () => {
    expect(statusText(request())).toBe("Waiting for review");
    expect(statusText(request({ status: "escalated" }))).toMatch(/^Moved up/);
    expect(statusText(request({ status: "denied", not_reviewed: true }))).toBe(
      "Declined: not reviewed in time",
    );
    expect(statusText(request({ status: "denied" }))).toBe("Declined");
    expect(statusText(request({ status: "cancelled" }))).toBe("Cancelled");
  });

  it("offers cancelling while it waits, and once approved only before the first day", () => {
    expect(canCancel(request(), "2026-11-19")).toBe(true);
    expect(canCancel(request({ status: "approved" }), "2026-11-22")).toBe(true);
    expect(canCancel(request({ status: "approved" }), "2026-11-23")).toBe(false);
    expect(canCancel(request({ status: "denied" }), "2026-11-19")).toBe(false);
  });

  it("checks the days before sending", () => {
    const today = "2026-11-19";
    expect(daysProblem("", "", today)).toBe("Choose the first day.");
    expect(daysProblem("2026-11-19", "2026-11-19", today)).toMatch(/tomorrow or later/);
    expect(daysProblem("2026-11-25", "2026-11-24", today)).toMatch(/cannot be before/);
    expect(daysProblem("2026-11-20", "2026-12-20", today)).toMatch(/at most 30 days/);
    expect(daysProblem("2026-11-20", "2026-12-19", today)).toBeNull();
  });

  it("names the days", () => {
    expect(dayRange("2026-11-23", "2026-11-23")).toBe("Monday, November 23");
    expect(dayRange("2026-11-23", "2026-11-27")).toBe("Mon, Nov 23 to Fri, Nov 27 (5 days)");
    // Across the clock change (November 1 in the US), still whole days.
    expect(daysIn("2026-10-31", "2026-11-02")).toBe(3);
  });
});

describe("the API calls", () => {
  it("asks, lists, and cancels at the right addresses", async () => {
    const fetchMock = serve(() => ({ items: [] }));
    await myRequests();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/time-off-requests?mine=true&limit=200");
    await askForTimeOff({ first_day: "2026-11-23", last_day: "2026-11-23", reason: null });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      first_day: "2026-11-23",
      last_day: "2026-11-23",
      reason: null,
    });
    await cancelTimeOff("../x");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/time-off-requests/..%2Fx/cancel");
  });
});

describe("the page", () => {
  /** Thursday 19 November 2026, 10:00 in Chicago. */
  const NOW = new Date("2026-11-19T16:00:00Z");

  it("does not offer today or earlier, and the last day follows the first", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    loadPage("time-off.html");
    serve((url) =>
      url.startsWith("/api/departments") ? { items: [], next_cursor: null } : { items: [] },
    );
    await showTimeOff();
    const first = /** @type {HTMLInputElement} */ (document.getElementById("first-day"));
    const last = /** @type {HTMLInputElement} */ (document.getElementById("last-day"));
    expect(first.min).toBe("2026-11-20");
    first.value = "2026-11-24";
    first.dispatchEvent(new Event("change"));
    expect(last.min).toBe("2026-11-24");
    expect(last.value).toBe("2026-11-24");
  });

  it("uses the home department's own time zone for today", async () => {
    // 01:00 on the 20th in Tokyo is still the 19th in Chicago.
    vi.useFakeTimers({ now: new Date("2026-11-19T16:30:00Z"), toFake: ["Date"] });
    loadPage("time-off.html");
    serve((url) =>
      url.startsWith("/api/departments")
        ? { items: [{ id: "d1", name: "Kitchen", timezone: "Asia/Tokyo" }], next_cursor: null }
        : { items: [] },
    );
    await showTimeOff();
    expect(/** @type {HTMLInputElement} */ (document.getElementById("first-day")).min).toBe(
      "2026-11-21",
    );
  });

  it("shows the shifts on the chosen days before sending", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    loadPage("time-off.html");
    serve((url) => {
      if (url.startsWith("/api/departments")) return { items: [], next_cursor: null };
      if (url.startsWith("/api/shifts")) {
        return {
          items: [
            {
              id: "s1",
              department: { id: "d1", name: "Kitchen" },
              employee: { id: "ana", display_name: "Ana" },
              starts_at: "2026-11-24T14:00:00Z",
              ends_at: "2026-11-24T22:00:00Z",
              timezone: "America/Chicago",
              status: "scheduled",
            },
          ],
          next_cursor: null,
        };
      }
      return { items: [] };
    });
    await showTimeOff();
    const first = /** @type {HTMLInputElement} */ (document.getElementById("first-day"));
    first.value = "2026-11-24";
    first.dispatchEvent(new Event("change"));
    await settle();
    await settle();
    const affected = document.getElementById("affected")?.textContent ?? "";
    expect(affected).toContain(
      "1 of your shifts falls on these days. If approved, it becomes an open shift",
    );
    expect(affected).toContain("Tuesday, November 24, 8:00 AM - 4:00 PM, Kitchen");
  });

  it("lists requests with the reason as text, never as HTML", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    loadPage("time-off.html");
    serve((url) =>
      url.startsWith("/api/departments")
        ? { items: [], next_cursor: null }
        : { items: [request({ reason: "<img src=x onerror=alert(1)>" })] },
    );
    await showTimeOff();
    const list = /** @type {HTMLElement} */ (document.getElementById("request-list"));
    expect(list.textContent).toContain("Reason: <img src=x onerror=alert(1)>");
    expect(list.querySelector("img")).toBeNull();
    expect(list.textContent).toContain("Waiting for review");
    expect([...list.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Cancel request",
    ]);
  });

  it("refuses to send days that cannot work, and says why", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    loadPage("time-off.html");
    const fetchMock = serve((url) =>
      url.startsWith("/api/departments") ? { items: [], next_cursor: null } : { items: [] },
    );
    await showTimeOff();
    const calls = fetchMock.mock.calls.length;
    /** @type {HTMLFormElement} */ (document.getElementById("time-off-form")).requestSubmit();
    expect(document.getElementById("form-problem")?.textContent).toBe("Choose the first day.");
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

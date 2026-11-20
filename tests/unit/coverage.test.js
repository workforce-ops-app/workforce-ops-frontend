// Swaps and coverage (docs/features/coverage.md), the employee's and the coworker's side:
// the checkbox on the time-off form, "Collecting offers" with "Send to my manager", the
// offers on the employee's own request by name, and the coworker's home-screen card with
// Cover, Swap (their own shifts outside the time off), and Decline, with a refusal shown
// in place. The API checks every rule again; these tests cover what the screens send and
// show, and that names and reasons stay text.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPage } from "./page-html.js";

vi.mock("../../js/components/app-shell.js", () => ({
  startSignedInPage: vi.fn(),
  waitingRequests: vi.fn(),
}));
vi.mock("../../js/core/session.js", () => ({
  can: () => true,
  currentSession: () => ({
    user: { id: "ben", display_name: "Ben", email: "b@x", department_id: "d1" },
    company: { id: "c", name: "Northwind", timezone: "America/Chicago" },
    permissions: [],
  }),
}));
// The confirm popup says yes and runs the change at once.
vi.mock("../../js/components/confirm-dialog.js", () => ({
  confirmChange: vi.fn(async (/** @type {{ run: () => Promise<unknown> }} */ options) => {
    await options.run();
    return true;
  }),
}));

const { swapChoices, offerCard } = await import("../../js/components/offer-card.js");
const { answerText, statusText } = await import("../../js/core/time-off-words.js");
const { offersList, showTimeOff, canCancel } = await import("../../js/pages/time-off.js");
const { showOffers } = await import("../../js/pages/my-shifts.js");
const { answerOffer, offerable, sendUp, withdrawOffer } = await import("../../js/api/time-off.js");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** Thursday 19 November 2026, 10:00 in Chicago. */
const NOW = new Date("2026-11-19T16:00:00Z");
const ZONE = "America/Chicago";

/** @returns {import("../../js/api/time-off.js").TimeOff} */
function request(overrides = {}) {
  return {
    id: "t1",
    employee_id: "cara",
    employee_name: "Cara Lee",
    first_day: "2026-11-23",
    last_day: "2026-11-27",
    reason: null,
    status: "collecting",
    not_reviewed: false,
    created_at: "2026-11-19T16:00:00Z",
    decided_at: null,
    offers_close_at: "2026-11-22T06:00:00Z",
    sent_up_at: null,
    ...overrides,
  };
}

/** Cara's Tuesday shift, 8:00 AM to 4:00 PM in Chicago. */
const WANTED = {
  id: "s1",
  department_id: "d1",
  starts_at: "2026-11-24T14:00:00Z",
  ends_at: "2026-11-24T22:00:00Z",
};

/**
 * One of Ben's own shifts, as GET /api/shifts sends it.
 * @param {string} id
 * @param {string} startsAt
 * @returns {import("../../js/api/shifts.js").Shift}
 */
function myShift(id, startsAt, overrides = {}) {
  const ends = new Date(new Date(startsAt).getTime() + 8 * 3600_000).toISOString();
  return /** @type {import("../../js/api/shifts.js").Shift} */ ({
    id,
    department: { id: "d1", name: "Kitchen" },
    employee: { id: "ben", display_name: "Ben" },
    starts_at: startsAt,
    ends_at: ends,
    timezone: ZONE,
    status: "scheduled",
    details: null,
    notes: null,
    ...overrides,
  });
}

/** @returns {import("../../js/api/time-off.js").Offer} */
function offer(overrides = {}) {
  return {
    id: "o1",
    shift_id: "s1",
    offered_by: "ben",
    offered_by_name: "Ben Okafor",
    answer: "cover",
    swap_shift: null,
    status: "offered",
    updated_at: "2026-11-19T16:00:00Z",
    ...overrides,
  };
}

/**
 * Answer each request by its address; a reply of { http, body } sets the status.
 * @param {(url: string, init: RequestInit) => unknown} reply
 */
function serve(reply) {
  const fetchMock = vi.fn().mockImplementation((url, init) => {
    const answer = /** @type {any} */ (reply(String(url), init ?? {}));
    const status = answer?.http ?? (init?.method === "POST" ? 201 : 200);
    const body = answer?.http ? answer.body : answer;
    return Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": status >= 400 ? "application/problem+json" : "application/json",
        },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the words", () => {
  it("names the new status and lets the employee cancel while it collects", () => {
    expect(statusText(request())).toBe("Collecting coworkers' offers");
    expect(canCancel(request(), "2026-11-19")).toBe(true);
  });

  it("says each answer with the coworker's name, and a swap with the shift given", () => {
    expect(answerText(offer(), ZONE)).toBe("Ben Okafor offers to cover");
    expect(answerText(offer({ answer: "decline" }), ZONE)).toBe("Ben Okafor declined");
    const swap = offer({
      answer: "swap",
      swap_shift: { ...WANTED, id: "s9", starts_at: "2026-11-30T14:00:00Z" },
    });
    expect(answerText(swap, ZONE)).toBe(
      "Ben Okafor offers a swap: Monday, November 30, 8:00 AM - 4:00 PM",
    );
    expect(answerText(offer(), ZONE, true)).toBe("You offer to cover");
  });
});

describe("the API calls", () => {
  it("answers, takes back, lists, and sends up at the right addresses", async () => {
    const fetchMock = serve(() => ({ items: [] }));
    await answerOffer("t1", "s1", "swap", "s9");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/time-off-requests/t1/offers/s1");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      answer: "swap",
      swap_shift_id: "s9",
    });
    // Cover and decline send no swap shift at all.
    await answerOffer("t1", "s1", "decline");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ answer: "decline" });
    // Ids are encoded, so a value cannot change the address.
    await withdrawOffer("../x", "s1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/time-off-requests/..%2Fx/offers/s1");
    expect(fetchMock.mock.calls[2][1].method).toBe("DELETE");
    await offerable();
    expect(fetchMock.mock.calls[3][0]).toBe("/api/time-off-requests/offerable");
    await sendUp("t1");
    expect(fetchMock.mock.calls[4][0]).toBe("/api/time-off-requests/t1/send-up");
  });
});

describe("the swap choices", () => {
  it("lists only the coworker's own upcoming shifts in that department, outside the days", () => {
    const shifts = [
      myShift("before", "2026-11-21T14:00:00Z"), // Saturday: outside, kept
      myShift("inside", "2026-11-25T14:00:00Z"), // Wednesday: a requested day
      myShift("after", "2026-11-30T14:00:00Z"), // Monday after: kept
      myShift("other", "2026-11-30T14:00:00Z", { department: { id: "d2", name: "Bar" } }),
      myShift("open", "2026-11-30T14:00:00Z", { status: "open" }),
      myShift("past", "2026-11-18T14:00:00Z"),
    ];
    const kept = swapChoices(WANTED, shifts, request(), NOW).map((shift) => shift.id);
    expect(kept).toEqual(["before", "after"]);
  });
});

describe("the coworker's card", () => {
  /** @param {Partial<import("../../js/api/time-off.js").Offerable>} [overrides] */
  function card(overrides = {}, onChange = vi.fn().mockResolvedValue(undefined)) {
    const item = { request: request(), shifts: [WANTED], answers: [], ...overrides };
    const myShifts = [myShift("s9", "2026-11-30T14:00:00Z")];
    const made = offerCard(item, { zone: ZONE, myShifts, now: NOW, onChange });
    document.body.append(made);
    return made;
  }
  /** @param {HTMLElement} root @param {string} label */
  const press = (root, label) =>
    /** @type {HTMLButtonElement} */ (
      [...root.querySelectorAll("button")].find((b) => b.textContent === label)
    ).click();

  it("shows the name and reason as text, never as HTML", () => {
    const made = card({
      request: request({ employee_name: "<b>Cara</b>", reason: "<img src=x onerror=alert(1)>" }),
    });
    expect(made.textContent).toContain("<b>Cara</b> asked for time off");
    expect(made.textContent).toContain("Reason: <img src=x onerror=alert(1)>");
    expect(made.querySelector("img, b")).toBeNull();
    expect(made.textContent).toContain("Tuesday, November 24, 8:00 AM - 4:00 PM");
    expect(made.textContent).toContain("You have not answered.");
  });

  it("offers Cover, a swap of one of their own shifts, and Decline", async () => {
    const fetchMock = serve(() => offer());
    const onChange = vi.fn().mockResolvedValue(undefined);
    const made = card({}, onChange);
    expect([...made.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Cover",
      "Swap",
      "Decline",
    ]);
    expect(made.querySelector("option")?.textContent).toBe(
      "Monday, November 30, 8:00 AM - 4:00 PM, Kitchen",
    );
    press(made, "Swap");
    await settle();
    await settle();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      answer: "swap",
      swap_shift_id: "s9",
    });
    expect(onChange).toHaveBeenCalled();
  });

  it("shows the person's own answer, with Take back", () => {
    const made = card({ answers: [offer()] });
    expect(made.textContent).toContain("You offer to cover.");
    expect([...made.querySelectorAll("button")].map((b) => b.textContent)).toContain("Take back");
  });

  it("shows a refusal in place, under the shift, and reloads nothing", async () => {
    serve(() => ({
      http: 409,
      body: { title: "Conflict", status: 409, detail: "Offers are closed for this request." },
    }));
    const onChange = vi.fn();
    const made = card({}, onChange);
    press(made, "Cover");
    await settle();
    await settle();
    const alert = /** @type {HTMLElement} */ (made.querySelector("[role=alert]"));
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toBe("Offers are closed for this request.");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("the home screen", () => {
  it("lists the coworkers' requests, or says nobody is asking", async () => {
    loadPage("my-shifts.html");
    serve((url) =>
      url.startsWith("/api/time-off-requests/offerable")
        ? { items: [{ request: request(), shifts: [WANTED], answers: [] }] }
        : { items: [], next_cursor: null },
    );
    await showOffers();
    expect(document.querySelectorAll("#home-offers .offer-card").length).toBe(1);
    expect(document.getElementById("offers-status")?.textContent).toBe("");

    serve(() => ({ items: [], next_cursor: null }));
    await showOffers();
    expect(document.getElementById("offers-status")?.textContent).toBe(
      "Nobody is asking for cover right now.",
    );
  });
});

describe("the employee's page", () => {
  it("sends the checkbox, then offers Send to my manager", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    loadPage("time-off.html");
    const fetchMock = serve((url, init) => {
      if (url.startsWith("/api/departments")) return { items: [], next_cursor: null };
      if (url.startsWith("/api/shifts")) return { items: [], next_cursor: null };
      if (init.method === "POST" && url.endsWith("/send-up")) return request({ status: "pending" });
      if (init.method === "POST") return request();
      return { items: [request()] };
    });
    await showTimeOff();
    const first = /** @type {HTMLInputElement} */ (document.getElementById("first-day"));
    const last = /** @type {HTMLInputElement} */ (document.getElementById("last-day"));
    first.value = "2026-11-23";
    last.value = "2026-11-27";
    /** @type {HTMLInputElement} */ (document.getElementById("offer-coverage")).checked = true;
    /** @type {HTMLFormElement} */ (document.getElementById("time-off-form")).requestSubmit();
    await settle();
    await settle();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post?.[1].body)).toMatchObject({ offer_coverage: true });
    expect(document.getElementById("status")?.textContent).toContain("Asked your coworkers");

    const list = /** @type {HTMLElement} */ (document.getElementById("request-list"));
    const buttons = [...list.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Send to my manager",
      "Coworkers' offers",
      "Cancel request",
    ]);
    buttons[0].click();
    await settle();
    await settle();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/t1/send-up"))).toBe(true);
  });

  it("lists every coworker's offer by name, under its shift", () => {
    const shown = offersList(
      {
        ...request(),
        decisions: [],
        affected_shifts: [WANTED, { ...WANTED, id: "s2", starts_at: "2026-11-25T14:00:00Z" }],
        offers: [offer(), offer({ id: "o2", offered_by_name: "<i>Dee</i>", answer: "decline" })],
      },
      ZONE,
    );
    const rows = [...shown.children].map((li) => li.textContent);
    expect(rows[0]).toContain("Ben Okafor offers to cover");
    expect(rows[0]).toContain("<i>Dee</i> declined");
    expect(shown.querySelector("i")).toBeNull();
    expect(rows[1]).toContain("No offers yet.");
  });
});

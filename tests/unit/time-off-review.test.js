// Review time off: the words for shifts, decisions, and states; the API calls; the page
// (cards with affected shifts and decisions, names as text, the team list); and the
// waiting count in the menu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPage } from "./page-html.js";

let permissions = ["time_off.review", "time_off.view"];
vi.mock("../../js/core/session.js", () => ({
  can: (/** @type {string} */ code) => permissions.includes(code),
  currentSession: () => ({
    user: { id: "chef", display_name: "Chef", email: "c@x", department_id: "d1" },
    company: { id: "c", name: "Northwind", timezone: "America/Chicago" },
    permissions,
  }),
  loadSession: vi.fn(),
  signOut: vi.fn(),
  SIGN_IN_PAGE: "/pages/sign-in.html",
}));
const { decisionLine, reviewState, shiftLine, showReview, statusLabel } =
  await import("../../js/pages/time-off-review.js");
const { decideTimeOff, teamRequests } = await import("../../js/api/time-off.js");
const { forgetWaitingRequests, showWaitingCount } =
  await import("../../js/components/app-shell.js");

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  permissions = ["time_off.review", "time_off.view"];
});

/** @returns {import("../../js/api/time-off.js").TimeOffDetail} */
function detail(overrides = {}) {
  return {
    id: "t1",
    employee_id: "ana",
    employee_name: "Ana Diaz",
    first_day: "2026-11-24",
    last_day: "2026-11-24",
    reason: null,
    status: "pending",
    not_reviewed: false,
    created_at: "2026-11-19T16:00:00Z",
    decided_at: null,
    affected_shifts: [
      {
        id: "s1",
        department_id: "d1",
        starts_at: "2026-11-24T14:00:00Z",
        ends_at: "2026-11-24T22:00:00Z",
      },
    ],
    decisions: [],
    ...overrides,
  };
}

/**
 * Answer each request by its address.
 * @param {(url: string) => unknown} reply
 */
function serve(reply) {
  const fetchMock = vi.fn().mockImplementation((url) =>
    Promise.resolve(
      new Response(JSON.stringify(reply(String(url))), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the words", () => {
  const departments = new Map([["d1", { name: "Kitchen", zone: "America/Chicago" }]]);

  it("names an affected shift in its department's time zone", () => {
    expect(shiftLine(detail().affected_shifts[0], departments, "UTC")).toBe(
      "Tuesday, November 24, 8:00 AM - 4:00 PM, Kitchen",
    );
    const elsewhere = { ...detail().affected_shifts[0], department_id: "d9" };
    expect(shiftLine(elsewhere, departments, "America/Chicago")).toMatch(/another department$/);
  });

  it("says each decision with its reviewer's name and comment", () => {
    const base = { approver_id: "x", decided_at: "2026-11-19T00:00:00Z" };
    expect(
      decisionLine({ ...base, approver_name: "Lee", decision: "approve", comment: null }),
    ).toBe("Lee approved.");
    expect(
      decisionLine({ ...base, approver_name: "Kim", decision: "deny", comment: "short-staffed" }),
    ).toBe("Kim denied: short-staffed");
  });

  it("tells the reviewer when a disagreement moved the request up to them", () => {
    expect(reviewState(detail({ status: "escalated" }))).toMatch(/^Moved up to you/);
    expect(reviewState(detail())).toBe("Waiting for your decision.");
    expect(statusLabel(detail({ status: "escalated" }))).toBe("Moved up");
    expect(statusLabel(detail({ status: "denied", not_reviewed: true }))).toBe(
      "Declined: not reviewed in time",
    );
  });

  // Found in review: after one of two managers declined, the team list still said
  // "Waiting for review". The API's progress says who decided and who is left.
  it("says who already decided and who the request still waits for", () => {
    const felix = { id: "lead", display_name: "Felix Grant" };
    /** @param {"approve" | "deny"} decision @param {string} id @param {string} name */
    const step = (decision, id, name) => ({ approver_id: id, approver_name: name, decision });
    // The signed-in reviewer (chef) declined: their own decision reads "You".
    const mine = detail({
      progress: { decided: [step("deny", "chef", "Chef")], waiting_for: [felix] },
    });
    expect(statusLabel(mine)).toBe("You declined. Waiting for Felix Grant.");
    // Someone else decided first: named, and the card still asks for this reviewer's decision.
    const theirs = detail({
      progress: { decided: [step("approve", "lead", "Felix Grant")], waiting_for: [] },
    });
    expect(statusLabel(theirs)).toBe("Felix Grant approved.");
    expect(reviewState(theirs)).toBe("Felix Grant approved. Waiting for your decision.");
    // Nobody yet: who will review, with several names joined as in a sentence.
    const kim = { id: "kim", display_name: "Kim Lee" };
    const ray = { id: "ray", display_name: "Ray Ono" };
    expect(statusLabel(detail({ progress: { decided: [], waiting_for: [felix, kim, ray] } }))).toBe(
      "Waiting for review by Felix Grant, Kim Lee, and Ray Ono",
    );
    // Moved up: who it now waits for.
    const up = detail({ status: "escalated", progress: { decided: [], waiting_for: [kim] } });
    expect(statusLabel(up)).toBe("Moved up. Waiting for Kim Lee.");
    // Names are written by users: shown as text, never as markup.
    const odd = { id: "x", display_name: "<img src=x onerror=alert(1)>" };
    const shown = statusLabel(detail({ progress: { decided: [], waiting_for: [odd] } }));
    expect(shown).toBe("Waiting for review by <img src=x onerror=alert(1)>");
  });
});

describe("the API calls", () => {
  it("sends decisions and filters to the right addresses", async () => {
    const fetchMock = serve(() => ({ items: [] }));
    await decideTimeOff("a/b", "deny", "no");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/time-off-requests/a%2Fb/deny");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ comment: "no" });
    await teamRequests("approved");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/time-off-requests?limit=200&status=approved");
    await teamRequests("");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/time-off-requests?limit=200");
  });
});

describe("the page", () => {
  /** @param {import("../../js/api/time-off.js").TimeOffDetail} one */
  function serveWith(one) {
    return serve((url) => {
      if (url.startsWith("/api/departments")) {
        return { items: [{ id: "d1", name: "Kitchen", timezone: null }], next_cursor: null };
      }
      if (url.startsWith("/api/time-off-requests/waiting")) return { items: [one] };
      if (url.startsWith("/api/time-off-requests/t1")) return one;
      return { items: [one] };
    });
  }

  it("shows each waiting request with its shifts, decisions, and buttons", async () => {
    loadPage("time-off-review.html");
    serveWith(
      detail({
        status: "escalated",
        decisions: [
          {
            approver_id: "m1",
            approver_name: "Lee",
            decision: "approve",
            decided_at: "2026-11-19T00:00:00Z",
            comment: null,
          },
          {
            approver_id: "m2",
            approver_name: "Kim",
            decision: "deny",
            decided_at: "2026-11-19T00:00:00Z",
            comment: "short-staffed",
          },
        ],
      }),
    );
    await showReview();
    const card = /** @type {HTMLElement} */ (document.querySelector("#waiting-list li"));
    expect(card.textContent).toContain("Ana Diaz: Tuesday, November 24");
    expect(card.textContent).toContain("Moved up to you");
    expect(card.textContent).toContain("Tuesday, November 24, 8:00 AM - 4:00 PM, Kitchen");
    expect(card.textContent).toContain("Lee approved.");
    expect(card.textContent).toContain("Kim denied: short-staffed");
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Approve",
      "Deny",
    ]);
  });

  it("shows names, reasons, and comments as text, never as HTML", async () => {
    loadPage("time-off-review.html");
    const evil = "<img src=x onerror=alert(1)>";
    serveWith(
      detail({
        employee_name: evil,
        reason: evil,
        decisions: [
          {
            approver_id: "m1",
            approver_name: evil,
            decision: "deny",
            decided_at: "2026-11-19T00:00:00Z",
            comment: evil,
          },
        ],
      }),
    );
    await showReview();
    expect(document.querySelector("main img, #waiting-list img, #team-list img")).toBeNull();
    expect(document.getElementById("waiting-list")?.textContent).toContain(`Reason: ${evil}`);
  });

  it("asks before approving, and says the shifts will open", async () => {
    loadPage("time-off-review.html");
    serveWith(detail());
    await showReview();
    /** @type {HTMLButtonElement} */ (document.querySelector("#waiting-list button")).click();
    await settle();
    const dialog = /** @type {HTMLElement} */ (document.querySelector("dialog"));
    expect(dialog.textContent).toContain("Approve time off for Ana Diaz?");
    expect(dialog.textContent).toContain("their shift on these days becomes an open shift");
  });

  it("lists team requests by status", async () => {
    loadPage("time-off-review.html");
    serveWith(detail({ status: "approved" }));
    await showReview();
    expect(document.getElementById("team-list")?.textContent).toContain("Ana Diaz");
    expect(document.getElementById("team-list")?.textContent).toContain("Approved");
  });
});

describe("the waiting count in the menu", () => {
  /** @param {number} count */
  function menu(count) {
    // Each call stands for a new page load, which asks the server again.
    forgetWaitingRequests();
    document.body.innerHTML =
      '<a href="/pages/time-off-review.html"><span data-waiting-count hidden></span></a>';
    serve(() => ({ items: Array.from({ length: count }, (_, i) => ({ id: String(i) })) }));
    return /** @type {HTMLElement} */ (document.querySelector("[data-waiting-count]"));
  }

  it("shows how many requests wait", async () => {
    const spot = menu(3);
    await showWaitingCount();
    expect(spot.hidden).toBe(false);
    expect(spot.textContent).toBe("3");
    expect(spot.getAttribute("aria-label")).toBe("3 waiting");
  });

  it("stays hidden with nothing waiting, or without time_off.review", async () => {
    const spot = menu(0);
    await showWaitingCount();
    expect(spot.hidden).toBe(true);
    permissions = [];
    const other = menu(5);
    await showWaitingCount();
    expect(other.hidden).toBe(true);
  });
});

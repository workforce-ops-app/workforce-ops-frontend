// The page frame: menu entries by permission, the account spot, and starting a page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";

// Replace the server calls, so each test decides what the "server" answers.
vi.mock("../../js/api/sessions.js", () => ({
  getCurrentSession: vi.fn(),
  signOut: vi.fn(),
}));
const { getCurrentSession, signOut: endSession } = await import("../../js/api/sessions.js");
const { forgetSession, SIGN_IN_PAGE } = await import("../../js/core/session.js");
const { startSignedInPage } = await import("../../js/components/app-shell.js");
/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);
const fetchSession = asMock(getCurrentSession);
const deleteSession = asMock(endSession);

/**
 * The answer of GET /api/sessions/current.
 * @param {string[]} permissions
 * @param {string} [name]
 */
function sessionWith(permissions, name = "Ana Diaz") {
  return {
    user: { id: "u1", display_name: name, email: "ana@example.com", department_id: "d1" },
    company: { id: "c1", name: "Northwind", timezone: "America/Chicago" },
    permissions,
    expires_at: "2026-11-10T12:00:00Z",
    csrf_token: "token-123",
  };
}

/** The frame as the pages have it: two tabs that start hidden, and the account spot. */
function frame() {
  /**
   * @param {string} id
   * @param {string} permission
   */
  const tab = (id, permission) => {
    const link = document.createElement("a");
    link.id = id;
    link.dataset.permission = permission;
    link.hidden = true;
    return link;
  };
  const account = document.createElement("div");
  account.id = "account";
  account.hidden = true;
  document.body.replaceChildren(
    tab("my-week", "schedule.view_self"),
    tab("department", "schedule.view"),
    account,
  );
}

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

beforeEach(() => {
  forgetSession();
  fetchSession.mockReset();
  deleteSession.mockReset();
  frame();
});
afterEach(() => document.body.replaceChildren());

describe("startSignedInPage", () => {
  it("shows only the menu entries the person may use, then the page", async () => {
    // Someone whose administrator removed schedule.view from the Employee role.
    fetchSession.mockResolvedValue(sessionWith(["schedule.view_self"]));
    const showPage = vi.fn().mockResolvedValue(undefined);

    await startSignedInPage(showPage, vi.fn());

    expect(byId("my-week").hidden).toBe(false);
    expect(byId("department").hidden).toBe(true);
    expect(showPage).toHaveBeenCalledTimes(1);
  });

  it("shows the person's name and a sign-out button", async () => {
    fetchSession.mockResolvedValue(sessionWith(["schedule.view_self", "schedule.view"]));

    await startSignedInPage(vi.fn().mockResolvedValue(undefined), vi.fn());

    expect(byId("account").hidden).toBe(false);
    expect(byId("account").textContent).toContain("Ana Diaz");
    expect(byId("account").querySelector("button")?.textContent).toBe("Sign out");
  });

  it("shows a name as text, never as HTML", async () => {
    const name = '<img src=x onerror="alert(1)">';
    fetchSession.mockResolvedValue(sessionWith([], name));

    await startSignedInPage(vi.fn().mockResolvedValue(undefined), vi.fn());

    expect(byId("account").querySelector("img")).toBeNull();
    expect(byId("account").textContent).toContain(name);
  });

  it("sends a signed-out visitor to sign in and never loads the page", async () => {
    fetchSession.mockRejectedValue(new ApiError(401, { title: "Unauthorized" }));
    const navigate = vi.fn();
    const showPage = vi.fn();

    await startSignedInPage(showPage, navigate);

    expect(navigate).toHaveBeenCalledWith(SIGN_IN_PAGE);
    expect(showPage).not.toHaveBeenCalled();
    expect(byId("account").hidden).toBe(true);
  });

  it("still loads the page when the server is unreachable, so it can say so", async () => {
    fetchSession.mockRejectedValue(new NetworkError(new TypeError("offline")));
    const showPage = vi.fn().mockResolvedValue(undefined);

    await startSignedInPage(showPage, vi.fn());

    expect(showPage).toHaveBeenCalledTimes(1);
    // Nothing is shown that depends on knowing who is signed in.
    expect(byId("department").hidden).toBe(true);
    expect(byId("account").hidden).toBe(true);
  });

  it("throws a bug in our own code on", async () => {
    fetchSession.mockRejectedValue(new TypeError("bug"));

    await expect(startSignedInPage(vi.fn(), vi.fn())).rejects.toBeInstanceOf(TypeError);
  });
});

describe("the sign-out button", () => {
  /** Load the frame for Ana and return the sign-out button and a fake navigate. */
  async function signedIn() {
    fetchSession.mockResolvedValue(sessionWith(["schedule.view_self"]));
    const navigate = vi.fn();
    await startSignedInPage(vi.fn().mockResolvedValue(undefined), navigate);
    const button = /** @type {HTMLButtonElement} */ (byId("account").querySelector("button"));
    return { button, navigate };
  }

  it("signs out and goes to the sign-in page", async () => {
    const { button, navigate } = await signedIn();
    deleteSession.mockResolvedValue(null);

    button.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(SIGN_IN_PAGE));
    expect(deleteSession).toHaveBeenCalledTimes(1);
  });

  it("sends one request however often it is clicked", async () => {
    const { button } = await signedIn();
    deleteSession.mockReturnValue(new Promise(() => {})); // never answers

    button.click();
    button.click();

    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
  });

  it("stays and says so when signing out failed", async () => {
    const { button, navigate } = await signedIn();
    deleteSession.mockRejectedValue(new NetworkError(new TypeError("offline")));

    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(navigate).not.toHaveBeenCalled();
    expect(byId("account").textContent).toContain("sign-out failed");
  });
});

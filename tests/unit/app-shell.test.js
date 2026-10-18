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
const { reloadIfRestored, startSignedInPage } = await import("../../js/components/app-shell.js");
/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);
const fetchSession = asMock(getCurrentSession);
const deleteSession = asMock(endSession);

/**
 * The answer of GET /api/sessions/current.
 * @param {string[]} permissions
 * @param {string} [name]
 * @param {string} [companyName]
 */
function sessionWith(permissions, name = "Ana Diaz", companyName = "Northwind") {
  return {
    user: { id: "u1", display_name: name, email: "ana@example.com", department_id: "d1" },
    company: { id: "c1", name: companyName, timezone: "America/Chicago" },
    permissions,
    expires_at: "2026-11-10T12:00:00Z",
    csrf_token: "token-123",
  };
}

/**
 * The frame as the pages have it: the brand with the application's name, two tabs, the
 * account spot, and the page, all hidden, and the "Loading..." line shown in the meantime.
 */
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
  const main = document.createElement("main");
  main.id = "page";
  main.hidden = true;
  const loading = document.createElement("p");
  loading.id = "page-loading";
  const brand = document.createElement("span");
  brand.id = "brand";
  brand.className = "brand__name";
  brand.textContent = "Workforce Operations";
  document.body.replaceChildren(
    brand,
    tab("my-week", "schedule.view_self"),
    tab("department", "schedule.view"),
    account,
    loading,
    main,
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
    expect(byId("page").hidden).toBe(false);
    expect(showPage).toHaveBeenCalledTimes(1);
  });

  it("shows the page only once the session has loaded", async () => {
    /** @type {(value: unknown) => void} */
    let answer = () => {};
    fetchSession.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    const started = startSignedInPage(vi.fn().mockResolvedValue(undefined), vi.fn());
    // The server has not answered yet: the page is still hidden, "Loading..." shows.
    expect(byId("page").hidden).toBe(true);
    expect(byId("page-loading").hidden).toBe(false);

    answer(sessionWith(["schedule.view_self"]));
    await started;
    expect(byId("page").hidden).toBe(false);
    expect(byId("page-loading").hidden).toBe(true);
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

  it("shows the company's name in the brand", async () => {
    fetchSession.mockResolvedValue(sessionWith(["schedule.view_self"]));

    await startSignedInPage(vi.fn().mockResolvedValue(undefined), vi.fn());

    expect(byId("brand").textContent).toBe("Northwind");
  });

  it("shows the company's name in the browser tab's title", async () => {
    document.title = "My week · Workforce Operations";
    fetchSession.mockResolvedValue(sessionWith(["schedule.view_self"]));

    await startSignedInPage(vi.fn().mockResolvedValue(undefined), vi.fn());

    expect(document.title).toBe("My week · Northwind");
  });

  it("shows a company name as text, never as HTML", async () => {
    const company = '<img src=x onerror="alert(1)">';
    fetchSession.mockResolvedValue(sessionWith([], "Ana Diaz", company));

    await startSignedInPage(vi.fn().mockResolvedValue(undefined), vi.fn());

    expect(byId("brand").querySelector("img")).toBeNull();
    expect(byId("brand").textContent).toBe(company);
  });

  it("sends a signed-out visitor to sign in and never loads the page", async () => {
    fetchSession.mockRejectedValue(new ApiError(401, { title: "Unauthorized" }));
    const navigate = vi.fn();
    const showPage = vi.fn();

    await startSignedInPage(showPage, navigate);

    expect(navigate).toHaveBeenCalledWith(SIGN_IN_PAGE);
    expect(showPage).not.toHaveBeenCalled();
    expect(byId("account").hidden).toBe(true);
    // Not even the heading or the week buttons appear before the browser leaves.
    expect(byId("page").hidden).toBe(true);
  });

  it("still loads the page when the server is unreachable, so it can say so", async () => {
    document.title = "My week · Workforce Operations";
    fetchSession.mockRejectedValue(new NetworkError(new TypeError("offline")));
    const showPage = vi.fn().mockResolvedValue(undefined);

    await startSignedInPage(showPage, vi.fn());

    expect(showPage).toHaveBeenCalledTimes(1);
    // The page is shown, so its "Problem: ..." message can be read.
    expect(byId("page").hidden).toBe(false);
    // Nothing is shown that depends on knowing who is signed in.
    expect(byId("department").hidden).toBe(true);
    expect(byId("account").hidden).toBe(true);
    // The brand keeps the application's name, so the home link still has one.
    expect(byId("brand").textContent).toBe("Workforce Operations");
    expect(document.title).toBe("My week · Workforce Operations");
  });

  it("throws a bug in our own code on", async () => {
    fetchSession.mockRejectedValue(new TypeError("bug"));

    await expect(startSignedInPage(vi.fn(), vi.fn())).rejects.toBeInstanceOf(TypeError);
  });
});

describe("returning with the Back button", () => {
  it("reloads a page the browser restored from its cache, so the session is checked again", () => {
    const reload = vi.fn();
    reloadIfRestored(/** @type {PageTransitionEvent} */ ({ persisted: true }), reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a normal page load", () => {
    const reload = vi.fn();
    reloadIfRestored(/** @type {PageTransitionEvent} */ ({ persisted: false }), reload);
    expect(reload).not.toHaveBeenCalled();
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

describe("the company's logo", () => {
  /** Add the logo spot as the pages have it: the application's logo inside. */
  function logoSpot() {
    const spot = document.createElement("span");
    spot.id = "logo";
    spot.className = "brand__logo";
    const img = document.createElement("img");
    img.src = "/images/logos/app-square.png";
    img.alt = "";
    spot.append(img);
    document.body.append(spot);
  }

  /**
   * Ana's session at a company with the given name.
   * @param {string} name
   */
  function sessionAt(name) {
    const session = sessionWith(["schedule.view_self"]);
    return { ...session, company: { ...session.company, name } };
  }

  const logo = () => /** @type {HTMLImageElement} */ (byId("logo").querySelector("img"));

  it("replaces the application's logo with the company's", async () => {
    logoSpot();
    fetchSession.mockResolvedValue(sessionAt("Summit Outfitters"));

    await startSignedInPage(vi.fn().mockResolvedValue(undefined), vi.fn());

    expect(logo().getAttribute("src")).toBe("/images/logos/summit-outfitters.png");
    expect(byId("brand").textContent).toBe("Summit Outfitters");
    // The company's name next to it already says what the image shows.
    expect(logo().alt).toBe("");
    expect(byId("logo").querySelectorAll("img")).toHaveLength(1);
  });

  it("keeps the application's logo for a company without one", async () => {
    logoSpot();
    fetchSession.mockResolvedValue(sessionAt("Northwind"));

    await startSignedInPage(vi.fn().mockResolvedValue(undefined), vi.fn());

    expect(logo().getAttribute("src")).toBe("/images/logos/app-square.png");
  });

  it("keeps the application's logo when the session cannot be loaded", async () => {
    logoSpot();
    fetchSession.mockRejectedValue(new NetworkError(new TypeError("offline")));

    await startSignedInPage(vi.fn().mockResolvedValue(undefined), vi.fn());

    expect(logo().getAttribute("src")).toBe("/images/logos/app-square.png");
  });
});

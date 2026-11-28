// My account: changing the password (and taking the new session's CSRF token), and signing
// out everywhere. Tested against the real page markup (pages/account.html).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real API client, except that setCsrfToken is watched, to see the new token arrive.
vi.mock("../../js/api/client.js", async (importOriginal) => {
  const real = /** @type {object} */ (await importOriginal());
  return { ...real, setCsrfToken: vi.fn() };
});
// Who is signed in: each test decides.
vi.mock("../../js/core/session.js", () => ({
  SIGN_IN_PAGE: "/pages/sign-in.html",
  currentSession: vi.fn(),
  forgetSession: vi.fn(),
}));
// The page starts through the frame; here each test calls showAccount directly.
vi.mock("../../js/components/app-shell.js", () => ({ startSignedInPage: vi.fn() }));

const { ApiError, setCsrfToken } = await import("../../js/api/client.js");
const { currentSession, forgetSession } = await import("../../js/core/session.js");
const { showAccount } = await import("../../js/pages/account.js");
const { loadPage } = await import("./page-html.js");

/** @param {unknown} fn */
const asMock = (fn) => /** @type {import("vitest").Mock} */ (fn);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const GOOD = "four ordinary words together";

beforeEach(() => {
  asMock(currentSession).mockReturnValue({
    user: { id: "u1", display_name: "<i>Ana</i>", email: "ana@northwind.example" },
  });
  loadPage("account.html");
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

function parts() {
  return {
    form: /** @type {HTMLFormElement} */ (document.getElementById("password-form")),
    current: /** @type {HTMLInputElement} */ (document.getElementById("current-password")),
    next: /** @type {HTMLInputElement} */ (document.getElementById("new-password")),
    repeat: /** @type {HTMLInputElement} */ (document.getElementById("repeat-password")),
    message: /** @type {HTMLElement} */ (document.getElementById("password-message")),
    done: /** @type {HTMLElement} */ (document.getElementById("password-done")),
  };
}

/** @param {ReturnType<typeof parts>} p */
function fill(p) {
  p.current.value = "the old one, long enough";
  p.next.value = GOOD;
  p.repeat.value = GOOD;
}

describe("My account", () => {
  it("shows who is signed in as text, and gives password managers the email", async () => {
    await showAccount({ change: vi.fn(), endAll: vi.fn(), confirm: vi.fn() });
    const who = document.getElementById("account-who");
    expect(who?.textContent).toBe("Signed in as <i>Ana</i> (ana@northwind.example)");
    expect(who?.querySelector("i")).toBeNull();
    const username = /** @type {HTMLInputElement} */ (document.getElementById("account-username"));
    expect(username.value).toBe("ana@northwind.example");
    expect(username.autocomplete).toBe("username");
  });

  it("changes the password and uses the new session's CSRF token", async () => {
    const change = vi.fn().mockResolvedValue({ csrf_token: "fresh-token" });
    await showAccount({ change, endAll: vi.fn(), confirm: vi.fn() });
    const p = parts();
    fill(p);
    p.form.requestSubmit();
    await settle();
    expect(change).toHaveBeenCalledWith("the old one, long enough", GOOD);
    expect(setCsrfToken).toHaveBeenCalledWith("fresh-token");
    expect(p.done.hidden).toBe(false);
    expect([p.current.value, p.next.value, p.repeat.value]).toEqual(["", "", ""]);
  });

  it("checks the new password before sending it", async () => {
    const change = vi.fn();
    await showAccount({ change, endAll: vi.fn(), confirm: vi.fn() });
    const p = parts();
    fill(p);
    p.repeat.value = "something else entirely";
    p.form.requestSubmit();
    expect(p.message.textContent).toBe("The two passwords are not the same.");
    expect(change).not.toHaveBeenCalled();
  });

  it("says when the current password is wrong", async () => {
    const change = vi.fn().mockRejectedValue(new ApiError(403, { title: "Forbidden" }));
    await showAccount({ change, endAll: vi.fn(), confirm: vi.fn() });
    const p = parts();
    fill(p);
    p.form.requestSubmit();
    await settle();
    expect(p.message.textContent).toBe("Your current password is not right.");
    expect(p.current.getAttribute("aria-invalid")).toBe("true");
    expect(setCsrfToken).not.toHaveBeenCalled();
  });

  it("says the backend's wrong-password answer in the page's own words", async () => {
    const wrong = new ApiError(403, { title: "Forbidden", detail: "That password is not right." });
    const change = vi.fn().mockRejectedValue(wrong);
    await showAccount({ change, endAll: vi.fn(), confirm: vi.fn() });
    const p = parts();
    fill(p);
    p.form.requestSubmit();
    await settle();
    expect(p.message.textContent).toBe("Your current password is not right.");
  });

  it("says when the account is locked, in the backend's words, so the person waits", async () => {
    const locked = new ApiError(403, {
      title: "Forbidden",
      detail: "Too many wrong passwords. Wait a while and try again.",
    });
    const change = vi.fn().mockRejectedValue(locked);
    await showAccount({ change, endAll: vi.fn(), confirm: vi.fn() });
    const p = parts();
    fill(p);
    p.form.requestSubmit();
    await settle();
    expect(p.message.textContent).toBe("Too many wrong passwords. Wait a while and try again.");
    expect(p.message.textContent).not.toContain("not right");
    expect(setCsrfToken).not.toHaveBeenCalled();
  });

  it("asks before signing out everywhere, then goes to the sign-in page", async () => {
    const endAll = vi.fn().mockResolvedValue(null);
    // The question, answered yes: it runs the change, as the real popup does.
    const confirm = vi.fn(async (/** @type {{ run: () => Promise<unknown> }} */ options) => {
      await options.run();
      return true;
    });
    const navigate = vi.fn();
    await showAccount({ change: vi.fn(), endAll, confirm, navigate });
    document.getElementById("sign-out-everywhere")?.click();
    await settle();
    expect(confirm).toHaveBeenCalledOnce();
    expect(endAll).toHaveBeenCalledOnce();
    expect(forgetSession).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/pages/sign-in.html");
  });

  it("stays when the person goes back from the question", async () => {
    const endAll = vi.fn();
    const navigate = vi.fn();
    await showAccount({
      change: vi.fn(),
      endAll,
      confirm: vi.fn().mockResolvedValue(false),
      navigate,
    });
    document.getElementById("sign-out-everywhere")?.click();
    await settle();
    expect(endAll).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

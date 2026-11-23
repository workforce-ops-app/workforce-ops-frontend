// Setting a password from a link: the token leaves the address bar, and each answer is
// explained. Tested against the real page markup (pages/set-password.html).
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../js/api/client.js";
import { LINK_NOT_WORKING, startSetPassword, takeToken } from "../../js/pages/set-password.js";
import { loadPage } from "./page-html.js";

afterEach(() => document.body.replaceChildren());

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function parts() {
  return {
    form: /** @type {HTMLFormElement} */ (document.getElementById("set-password-form")),
    password: /** @type {HTMLInputElement} */ (document.getElementById("new-password")),
    repeat: /** @type {HTMLInputElement} */ (document.getElementById("repeat-password")),
    message: /** @type {HTMLElement} */ (document.getElementById("set-password-message")),
    done: /** @type {HTMLElement} */ (document.getElementById("set-password-done")),
  };
}

/**
 * A fake address and history, for takeToken.
 * @param {string} hash
 */
function address(hash) {
  const history = { replaceState: vi.fn() };
  const where = { hash, pathname: "/pages/set-password.html", search: "" };
  return {
    history,
    where: /** @type {Location} */ (/** @type {unknown} */ (where)),
    asHistory: /** @type {History} */ (/** @type {unknown} */ (history)),
  };
}

const GOOD = "four ordinary words together";

describe("takeToken", () => {
  it("returns the token and removes it from the address bar", () => {
    const { history, where, asHistory } = address("#token=abc123");
    expect(takeToken(where, asHistory)).toBe("abc123");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/pages/set-password.html");
  });

  it("returns null for an address without a token", () => {
    const { history, where, asHistory } = address("");
    expect(takeToken(where, asHistory)).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});

describe("the set-password page", () => {
  it("says the link does not work when it has no token, and offers no form", () => {
    loadPage("set-password.html");
    startSetPassword({ token: null, send: vi.fn() });
    const { form, message } = parts();
    expect(form.hidden).toBe(true);
    expect(message.textContent).toBe(LINK_NOT_WORKING);
  });

  it("checks the rules before sending anything", () => {
    loadPage("set-password.html");
    const send = vi.fn();
    startSetPassword({ token: "t", send });
    const { form, password, repeat, message } = parts();
    password.value = "too short";
    repeat.value = "too short";
    form.requestSubmit();
    expect(message.textContent).toBe("The password needs at least 15 characters.");
    password.value = GOOD;
    repeat.value = `${GOOD}!`;
    form.requestSubmit();
    expect(message.textContent).toBe("The two passwords are not the same.");
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the token in the body with the password, then points to sign-in", async () => {
    loadPage("set-password.html");
    const send = vi.fn().mockResolvedValue(null);
    startSetPassword({ token: "t0k3n", send });
    const { form, password, repeat, done } = parts();
    expect(password.autocomplete).toBe("new-password");
    password.value = GOOD;
    repeat.value = GOOD;
    form.requestSubmit();
    await settle();
    expect(send).toHaveBeenCalledWith("t0k3n", GOOD);
    expect(done.hidden).toBe(false);
    expect(form.hidden).toBe(true);
    expect(password.value).toBe("");
  });

  it("gives one answer for a link that does not work, and stops offering the form", async () => {
    loadPage("set-password.html");
    const send = vi.fn().mockRejectedValue(new ApiError(400, { title: "Bad Request" }));
    startSetPassword({ token: "used", send });
    const { form, password, repeat, message } = parts();
    password.value = GOOD;
    repeat.value = GOOD;
    form.requestSubmit();
    await settle();
    expect(message.textContent).toBe(LINK_NOT_WORKING);
    expect(form.hidden).toBe(true);
  });

  it("shows the server's reason for a refused password as text, and keeps the form", async () => {
    loadPage("set-password.html");
    const reason = "<b>This password is too common.</b>";
    const send = vi.fn().mockRejectedValue(new ApiError(422, { detail: reason }));
    startSetPassword({ token: "t", send });
    const { form, password, repeat, message } = parts();
    password.value = GOOD;
    repeat.value = GOOD;
    form.requestSubmit();
    await settle();
    expect(message.textContent).toBe(reason);
    expect(message.querySelector("b")).toBeNull(); // never parsed as HTML
    expect(form.hidden).toBe(false);
  });
});

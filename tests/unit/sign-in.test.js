// Tests for backend availability, sign-in, and form validation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSignIn, showApiStatus } from "../../js/pages/sign-in.js";

/** @type {import("vitest").Mock} */
let fetchMock;

beforeEach(() => {
  // A page with the status paragraph the script fills in (built with DOM calls, not HTML).
  const status = document.createElement("p");
  status.id = "api-status";
  document.body.replaceChildren(status);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** The text the page shows. */
function shown() {
  return document.getElementById("api-status")?.textContent;
}

/**
 * A fake JSON answer.
 * @param {number} status
 * @param {string} body
 */
function json(status, body) {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

describe("showApiStatus", () => {
  it("shows the server status", async () => {
    fetchMock.mockResolvedValue(json(200, JSON.stringify({ status: "ok" })));

    await showApiStatus();

    expect(shown()).toBe("Server status: ok");
  });

  it("says the server could not be reached when no answer arrives", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await showApiStatus();

    expect(shown()).toBe("Problem: the server could not be reached");
  });

  it("shows the title of an error answer", async () => {
    fetchMock.mockResolvedValue(json(503, JSON.stringify({ title: "Service Unavailable" })));

    await showApiStatus();

    expect(shown()).toBe("Problem: Service Unavailable");
  });

  it("does not disguise a bug as a network problem", async () => {
    // A successful answer the page cannot use (null instead of an object) makes reading
    // health.status fail: a bug in our code, not an unreachable server. The page says so
    // in general terms and throws the real error on, so it shows in the console.
    fetchMock.mockResolvedValue(json(200, "null"));

    await expect(showApiStatus()).rejects.toThrow(TypeError);
    expect(shown()).toBe("Problem: this page could not load");
  });
});

describe("handleSignIn", () => {
  /**
   * Build the same basic form elements used by sign-in.html.
   */
  function createForm() {
    const form = document.createElement("form");

    const email = document.createElement("input");
    email.id = "email";
    email.type = "email";
    email.required = true;
    email.value = "ana.diaz@example.com";

    const password = document.createElement("input");
    password.id = "password";
    password.type = "password";
    password.required = true;
    password.value = "incorrect-password";

    const message = document.createElement("p");
    message.id = "sign-in-message";
    message.hidden = true;

    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Sign in";

    form.append(email, password, message, button);
    document.body.append(form);

    return { form, message, button };
  }

  /**
   * @param {HTMLFormElement} form
   */
  function submit(form) {
    const event = new Event("submit", { cancelable: true });
    Object.defineProperty(event, "currentTarget", {
      value: form,
    });
    return { event, promise: handleSignIn(event) };
  }

  it("prevents the normal form submission", async () => {
    const { form } = createForm();

    fetchMock.mockResolvedValue(json(401, JSON.stringify({ title: "Unauthorized" })));

    const { event, promise } = submit(form);

    expect(event.defaultPrevented).toBe(true);

    await promise;
  });

  it("shows the same generic error for invalid credentials", async () => {
    const { form, message, button } = createForm();

    fetchMock.mockResolvedValue(
      json(
        401,
        JSON.stringify({
          detail: "Email or password is incorrect.",
        }),
      ),
    );

    await submit(form).promise;

    expect(message.hidden).toBe(false);
    expect(message.textContent).toContain("Email or password is incorrect");
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Sign in");
  });

  it("handles a network failure", async () => {
    const { form, message, button } = createForm();

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await submit(form).promise;

    expect(message.hidden).toBe(false);
    expect(message.textContent).toBe("Unable to reach the server. Please try again.");
    expect(button.disabled).toBe(false);
  });

  it("prevents duplicate sign-in requests", async () => {
    const { form, button } = createForm();
    /**
     * @type {((response: Response) => void) | undefined}
     */
    let resolveRequest;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const first = submit(form);

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Signing in...");

    const second = submit(form);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    if (!resolveRequest) {
      throw new Error("The mocked request was not started.");
    }

    resolveRequest(json(401, JSON.stringify({ title: "Unauthorized" })));

    await Promise.all([first.promise, second.promise]);

    expect(button.disabled).toBe(false);
  });

  it("requires an email before contacting the server", async () => {
    const { form, message } = createForm();
    const email = form.querySelector("#email");

    if (!(email instanceof HTMLInputElement)) {
      throw new Error("Email input not found.");
    }

    email.value = "";

    await submit(form).promise;

    expect(message.textContent).toBe("Please enter your email address.");
    expect(message.hidden).toBe(false);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid email format", async () => {
    const { form, message } = createForm();
    const email = form.querySelector("#email");

    if (!(email instanceof HTMLInputElement)) {
      throw new Error("Email input not found.");
    }

    email.value = "not-an-email";

    await submit(form).promise;

    expect(message.textContent).toBe("Please enter a valid email address.");
    expect(message.hidden).toBe(false);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a password before contacting the server", async () => {
    const { form, message } = createForm();
    const password = form.querySelector("#password");

    if (!(password instanceof HTMLInputElement)) {
      throw new Error("Password input not found.");
    }

    password.value = "";

    await submit(form).promise;

    expect(message.textContent).toBe("Please enter your password.");
    expect(message.hidden).toBe(false);
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

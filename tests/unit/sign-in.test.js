// Tests for backend availability, sign-in, and form validation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSignIn, resetSignInForm, showApiStatus } from "../../js/pages/sign-in.js";

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
    form.id = "sign-in-form";

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
   * @param {((path: string) => void) | undefined} [navigate]
   */
  function submit(form, navigate) {
    const event = new Event("submit", { cancelable: true });
    Object.defineProperty(event, "currentTarget", {
      value: form,
    });
    return { event, promise: handleSignIn(event, navigate) };
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

  it("redirects a successful sign-in to My Shifts", async () => {
    const { form } = createForm();
    const navigate = vi.fn();

    fetchMock.mockResolvedValue(json(201, JSON.stringify({ user: { id: "user-1" } })));

    await submit(form, navigate).promise;

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/pages/my-shifts.html");
  });

  it("shows a server error with its reference number", async () => {
    const { form, message, button } = createForm();

    fetchMock.mockResolvedValue(
      json(
        500,
        JSON.stringify({
          title: "Internal Server Error",
          error_id: "error-reference-123",
        }),
      ),
    );

    await submit(form).promise;

    expect(message.textContent).toBe(
      "Something went wrong. Please try again. Reference: error-reference-123.",
    );
    expect(message.hidden).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("does not disguise an unexpected error as a server failure", async () => {
    const { form, message } = createForm();

    // A successful answer with unreadable JSON fails outside the API's expected
    // ApiError and NetworkError paths, representing a bug that must remain visible.
    fetchMock.mockResolvedValue(json(200, "not-json"));

    await expect(submit(form).promise).rejects.toThrow(SyntaxError);
    expect(message.hidden).toBe(true);
  });

  it("explains when a rate-limited sign-in can be retried", async () => {
    const { form, message } = createForm();

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ title: "Too Many Requests" }), {
        status: 429,
        headers: { "Content-Type": "application/problem+json", "Retry-After": "30" },
      }),
    );

    await submit(form).promise;

    expect(message.textContent).toBe(
      "Too many attempts. Please try again later. Try again in 30 seconds.",
    );
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

  it("resets sensitive form state after a cached back navigation", () => {
    const { form, message, button } = createForm();
    const email = form.querySelector("#email");
    const password = form.querySelector("#password");

    if (!(email instanceof HTMLInputElement) || !(password instanceof HTMLInputElement)) {
      throw new Error("Sign-in inputs not found.");
    }

    email.classList.add("field__input--invalid");
    email.setAttribute("aria-invalid", "true");
    email.setAttribute("aria-describedby", "sign-in-message");
    password.value = "secret-password";
    message.hidden = false;
    button.disabled = true;
    button.textContent = "Signing in...";

    resetSignInForm(new PageTransitionEvent("pageshow", { persisted: true }));

    expect(email.value).toBe("");
    expect(password.value).toBe("");
    expect(email.classList.contains("field__input--invalid")).toBe(false);
    expect(email.hasAttribute("aria-invalid")).toBe(false);
    expect(message.hidden).toBe(true);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Sign in");
  });
});

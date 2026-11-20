// The sign-up page: what it checks before sending, what it sends, where it goes after,
// and how it explains each refusal. Run against the real pages/sign-up.html.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../js/api/client.js";
import {
  NEXT_PAGE,
  explain,
  formProblem,
  formatWait,
  startSignUp,
  timeZoneChoices,
} from "../../js/pages/sign-up.js";
import { loadPage } from "./page-html.js";

/**
 * A problem answer from the API, as js/api/client.js builds it.
 * @param {number} status
 * @param {string} [detail]
 * @param {object} [extra]
 * @param {Headers} [headers]
 */
function problem(status, detail = "", extra = {}, headers = new Headers()) {
  return new ApiError(status, { title: "Error", detail, ...extra }, headers);
}

const STRONG = "lanterns drift over quiet waters";

/**
 * Fill the form with valid values, some of them changed.
 * @param {Record<string, string>} [changes]
 */
function fill(changes = {}) {
  const values = {
    "company-name": "  Harbor Bakery ",
    "display-name": "Rosa Park",
    email: " rosa@harbor.example ",
    "new-password": STRONG,
    "repeat-password": STRONG,
    ...changes,
  };
  for (const [id, value] of Object.entries(values)) {
    /** @type {HTMLInputElement} */ (document.getElementById(id)).value = value;
  }
}

/** Submit the form and let the handler finish. */
async function submit() {
  const form = /** @type {HTMLFormElement} */ (document.getElementById("sign-up-form"));
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const message = () => /** @type {HTMLElement} */ (document.getElementById("sign-up-message"));

describe("time zone choices", () => {
  it("offers the browser's zones with its own chosen", () => {
    const choices = timeZoneChoices({
      supported: () => ["America/Chicago", "Europe/Paris"],
      own: () => "Europe/Paris",
    });
    expect(choices).toEqual({
      zones: ["America/Chicago", "Europe/Paris"],
      chosen: "Europe/Paris",
    });
  });

  it("adds the browser's own zone when the list leaves it out", () => {
    const choices = timeZoneChoices({ supported: () => ["Europe/Paris"], own: () => "UTC" });
    expect(choices.zones[0]).toBe("UTC");
    expect(choices.chosen).toBe("UTC");
  });

  it("falls back to common zones when the browser cannot list them", () => {
    const choices = timeZoneChoices({ supported: () => [], own: () => "America/Chicago" });
    expect(choices.zones).toContain("America/New_York");
    expect(choices.chosen).toBe("America/Chicago");
  });
});

describe("checks before sending", () => {
  const good = {
    company: "Harbor Bakery",
    zone: "America/New_York",
    name: "Rosa Park",
    email: "rosa@harbor.example",
    password: STRONG,
    repeat: STRONG,
    emailLooksValid: true,
  };

  it("finds nothing wrong with a complete form", () => {
    expect(formProblem(good)).toBeNull();
  });

  it.each([
    [{ company: "" }, "company-name"],
    [{ zone: "" }, "timezone"],
    [{ name: "" }, "display-name"],
    [{ email: "" }, "email"],
    [{ emailLooksValid: false }, "email"],
    [{ password: "too short", repeat: "too short" }, "new-password"],
    [{ repeat: "something else entirely" }, "new-password"],
  ])("points at the field that is wrong (%o)", (change, field) => {
    expect(formProblem({ ...good, ...change })?.field).toBe(field);
  });
});

describe("explaining a refusal", () => {
  it("shows the server's reason for a taken email or a weak password", () => {
    expect(explain(problem(409, "This email can't be used."))).toBe("This email can't be used.");
    expect(explain(problem(422, "This password is too common."))).toBe(
      "This password is too common.",
    );
  });

  it("joins field problems from the request checks", () => {
    const error = problem(422, "", { errors: [{ field: "timezone", message: "Unknown zone." }] });
    expect(explain(error)).toBe("Unknown zone.");
  });

  it("says how long to wait after too many sign-ups", () => {
    const headers = new Headers({ "Retry-After": "1800" });
    expect(explain(problem(429, "", {}, headers))).toBe(
      "Too many sign-ups from here. Try again in 30 minutes.",
    );
    expect(formatWait(1)).toBe("1 second");
    expect(formatWait(45)).toBe("45 seconds");
  });

  it("gives the reference of a server error and handles no answer", () => {
    expect(explain(problem(500, "", { error_id: "abc" }))).toContain("Reference: abc.");
    expect(explain(new NetworkError(new Error("down")))).toContain("Unable to reach the server");
  });

  it("leaves a bug in our own code to the console", () => {
    expect(explain(new TypeError("oops"))).toBeNull();
  });
});

describe("the page", () => {
  beforeEach(() => {
    loadPage("sign-up.html");
  });

  it("fills the time zones and the password rules", () => {
    startSignUp({
      zones: { zones: ["America/Chicago", "America/New_York"], chosen: "America/New_York" },
    });
    const zone = /** @type {HTMLSelectElement} */ (document.getElementById("timezone"));
    expect([...zone.options].map((option) => option.textContent)).toEqual([
      "America/Chicago",
      "America/New York",
    ]);
    expect(zone.value).toBe("America/New_York");
    expect(document.getElementById("password-rules")?.textContent).toContain("15 characters");
  });

  it("sends the trimmed fields and the exact password, then opens the setup", async () => {
    const send = vi.fn().mockResolvedValue({});
    const navigate = vi.fn();
    startSignUp({
      send,
      navigate,
      zones: { zones: ["America/New_York"], chosen: "America/New_York" },
    });
    fill({ "new-password": ` ${STRONG} `, "repeat-password": ` ${STRONG} ` });
    await submit();
    expect(send).toHaveBeenCalledWith({
      company_name: "Harbor Bakery",
      timezone: "America/New_York",
      display_name: "Rosa Park",
      email: "rosa@harbor.example",
      password: ` ${STRONG} `,
    });
    expect(navigate).toHaveBeenCalledWith(NEXT_PAGE);
    // Nothing of the password stays on the page.
    const password = /** @type {HTMLInputElement} */ (document.getElementById("new-password"));
    expect(password.value).toBe("");
  });

  it("does not send a form with a problem, and marks the field", async () => {
    const send = vi.fn();
    startSignUp({ send, zones: { zones: ["UTC"], chosen: "UTC" } });
    fill({ "repeat-password": "not the same at all, sorry" });
    await submit();
    expect(send).not.toHaveBeenCalled();
    expect(message().hidden).toBe(false);
    expect(message().textContent).toBe("The two passwords are not the same.");
    expect(document.getElementById("new-password")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the server's refusal as text and offers the form again", async () => {
    const send = vi.fn().mockRejectedValue(problem(409, "<b>This email can't be used.</b>"));
    const navigate = vi.fn();
    startSignUp({ send, navigate, zones: { zones: ["UTC"], chosen: "UTC" } });
    fill();
    await submit();
    expect(navigate).not.toHaveBeenCalled();
    // Text only: markup from an answer is never parsed.
    expect(message().textContent).toBe("<b>This email can't be used.</b>");
    expect(message().querySelector("b")).toBeNull();
    const button = /** @type {HTMLButtonElement} */ (
      document.querySelector('#sign-up-form button[type="submit"]')
    );
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Create company");
  });

  it("links back to sign-in", () => {
    expect(document.querySelector('a[href="/pages/sign-in.html"]')).not.toBeNull();
  });
});

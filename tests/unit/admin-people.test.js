// The People screen's rules (search, plain-word labels, "Sent for approval to ..."), the
// API calls it makes, and the popups it uses: the form and the link shown once.
import { afterEach, describe, expect, it, vi } from "vitest";

// The page starts through the frame; the tests start it themselves (showPeople).
vi.mock("../../js/components/app-shell.js", () => ({ startSignedInPage: vi.fn() }));
// The signed-in person: by default an administrator who holds every permission.
vi.mock("../../js/core/session.js", () => ({
  can: vi.fn(() => true),
  currentSession: vi.fn(() => ({ user: { id: "me" }, company: { timezone: "UTC" } })),
}));
const { FAILED, giveMessage, loadOrRefused, matches, scopeLabel, showPeople, statusLabel } =
  await import("../../js/pages/admin-people.js");
const { giveRole, listLines } = await import("../../js/api/roles.js");
const { makeLink } = await import("../../js/api/users.js");
const { INVALID_EMAIL, explainFormFailure, openFormDialog } =
  await import("../../js/components/form-dialog.js");
const { showLinkOnce } = await import("../../js/components/link-dialog.js");
const { ApiError, NetworkError } = await import("../../js/api/client.js");

/** @type {import("vitest").Mock} */
let fetchMock;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/**
 * Answer every request with this JSON.
 * @param {number} status
 * @param {unknown} body
 */
function answer(status, body) {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** @returns {import("../../js/api/users.js").Person} */
function person(overrides = {}) {
  return {
    id: "u1",
    display_name: "Ana Diaz",
    email: "ana@northwind.example",
    department_id: "d1",
    team_ids: [],
    status: "active",
    locked: false,
    you_are_above: true,
    ...overrides,
  };
}

describe("the People screen's rules", () => {
  it("finds people by every word of their name or email, ignoring case", () => {
    expect(matches(person(), "ana")).toBe(true);
    expect(matches(person(), "DIAZ northwind")).toBe(true);
    expect(matches(person(), "ana smith")).toBe(false);
    expect(matches(person(), "  ")).toBe(true);
  });

  it("says the account status in plain words", () => {
    expect(statusLabel(person({ status: "invited" }))).toBe("No password yet");
    expect(statusLabel(person({ locked: true }))).toBe("Active, locked");
  });

  it("names where a role applies", () => {
    const names = {
      departments: new Map([["d1", "Kitchen"]]),
      teams: new Map([["t1", "Weekend Crew"]]),
      people: new Map([["u2", "Ben"]]),
    };
    expect(scopeLabel({ scope_type: "company", scope_id: null }, names)).toBe("the whole company");
    expect(scopeLabel({ scope_type: "department", scope_id: "d1" }, names)).toBe(
      "the Kitchen department",
    );
    expect(scopeLabel({ scope_type: "team", scope_id: "t1" }, names)).toBe("the Weekend Crew team");
    expect(scopeLabel({ scope_type: "employee", scope_id: "u2" }, names)).toBe("only Ben");
  });

  it("says who a role was sent to for approval", () => {
    const request = (/** @type {string[]} */ ...names) => ({
      given: /** @type {const} */ (false),
      request: {
        id: "r",
        kind: "role_assignment",
        status: "pending",
        reviewers: names.map((n, i) => ({ id: `p${i}`, display_name: n })),
      },
    });
    expect(giveMessage(request("Owen"), "Administrator", "Chef")).toBe(
      "Sent for approval to Owen. Chef gets Administrator once it is approved.",
    );
    expect(giveMessage(request("A", "B", "C"), "X", "Y")).toMatch(
      /^Sent for approval to A, B and C\./,
    );
    expect(giveMessage(request(), "X", "Y")).toMatch(/Nobody can review it right now/);
  });
});

describe("the API calls", () => {
  it("tells a role given at once from one sent for approval", async () => {
    answer(201, { id: "a1", role_id: "r1", role_name: "Scheduler" });
    const grant = { user_id: "u1", role_id: "r1", scope_type: "company", scope_id: null };
    expect(await giveRole(grant)).toMatchObject({ given: true, assignment: { id: "a1" } });
    answer(202, { id: "q1", kind: "role_assignment", status: "pending", reviewers: [] });
    expect(await giveRole(grant)).toMatchObject({ given: false, request: { id: "q1" } });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/role-assignments");
  });

  it("keeps IDs from bending the address", async () => {
    answer(200, { items: [] });
    await listLines("a/b?c");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reporting-lines?user_id=a%2Fb%3Fc");
    answer(201, { purpose: "reset", link: "x", expires_at: "2026-11-20T00:00:00Z" });
    await makeLink("../x", "reset");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/users/..%2Fx/reset-link");
  });
});

describe("the form popup", () => {
  it("does not send with a required field empty, then sends the values", async () => {
    const run = vi.fn().mockResolvedValue("made");
    const result = openFormDialog({
      title: "Add a person",
      submitLabel: "Add",
      fields: [{ name: "display_name", label: "Name", type: "text", required: true }],
      run,
    });
    const form = /** @type {HTMLFormElement} */ (document.querySelector("dialog form"));
    form.requestSubmit();
    expect(run).not.toHaveBeenCalled();
    expect(document.querySelector("dialog [role=alert]")?.textContent).toBe("Please fill in name.");
    const input = /** @type {HTMLInputElement} */ (
      document.getElementById("form-dialog-display_name")
    );
    input.value = "  Dana  ";
    input.dispatchEvent(new Event("input"));
    form.requestSubmit();
    await expect(result).resolves.toBe("made");
    expect(run).toHaveBeenCalledWith({ display_name: "Dana" });
  });

  it("shows the server's refusal as text and stays open", async () => {
    const run = vi
      .fn()
      .mockRejectedValue(new ApiError(409, { detail: "<b>That email is taken.</b>" }));
    openFormDialog({
      title: "Add",
      submitLabel: "Add",
      fields: [{ name: "email", label: "Email", type: "email", value: "x@y.z" }],
      run,
    });
    /** @type {HTMLFormElement} */ (document.querySelector("dialog form")).requestSubmit();
    await settle();
    const alert = document.querySelector("dialog [role=alert]");
    expect(alert?.textContent).toBe("<b>That email is taken.</b>");
    expect(alert?.querySelector("b")).toBeNull();
    expect(document.querySelector("dialog")).not.toBeNull();
  });

  it("rebuilds choices that depend on another field", () => {
    openFormDialog({
      title: "Give a role",
      submitLabel: "Give",
      fields: [
        {
          name: "scope_type",
          label: "Where",
          type: "select",
          options: [
            { value: "company", label: "Company" },
            { value: "team", label: "Team" },
          ],
        },
        {
          name: "scope_id",
          label: "Which one",
          type: "select",
          shown: (values) => values.scope_type !== "company",
          options: () => [{ value: "t1", label: "Weekend Crew" }],
        },
      ],
      run: vi.fn(),
    });
    expect(document.getElementById("form-dialog-scope_id")).toBeNull();
    const where = /** @type {HTMLSelectElement} */ (
      document.getElementById("form-dialog-scope_type")
    );
    where.value = "team";
    where.dispatchEvent(new Event("change"));
    expect(
      /** @type {HTMLSelectElement} */ (document.getElementById("form-dialog-scope_id")).value,
    ).toBe("t1");
  });
});

describe("the link shown once", () => {
  it("shows the link with a copy button, and keeps it nowhere else", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    const closed = showLinkOnce(
      {
        purpose: "setup",
        link: "https://h/set-password.html#token=abc",
        expires_at: "2026-11-21T18:00:00Z",
      },
      { name: "Dana", zone: "America/Chicago", copy },
    );
    const field = /** @type {HTMLInputElement} */ (document.getElementById("link-dialog-link"));
    expect(field.value).toBe("https://h/set-password.html#token=abc");
    expect(field.readOnly).toBe(true);
    const [done, copyButton] = /** @type {HTMLButtonElement[]} */ ([
      ...document.querySelectorAll("dialog .edit-dialog__buttons button"),
    ]);
    copyButton.click();
    await settle();
    expect(copy).toHaveBeenCalledWith("https://h/set-password.html#token=abc");
    expect(document.querySelector("dialog [role=status]")?.textContent).toBe("Copied.");
    done.click();
    await closed;
    // Closed: the popup and the link are gone from the page.
    expect(document.body.textContent).not.toContain("token=abc");
  });
});

// --- The page itself, against a pretend server -------------------------------------------

/**
 * A JSON answer.
 * @param {number} status
 * @param {unknown} body
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Answer requests by their path: `routes` maps "GET /api/roles" (without the query) to a
 * function that gives the answer, or a promise of it (to hold an answer back). Paths not
 * listed answer an empty list. Every request is recorded in `fetchMock`.
 * @param {Record<string, (url: string) => Response | Promise<Response>>} routes
 */
function server(routes) {
  fetchMock = vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    const route = routes[`${init?.method ?? "GET"} ${url.split("?")[0]}`];
    return route ? route(url) : json(200, { items: [], next_cursor: null });
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** The people the pretend company has, as GET /api/users lists them. */
const people = () => ({
  items: [
    person({ id: "ana", display_name: "Ana Diaz", status: "invited" }),
    person({ id: "priya", display_name: "Priya Shah" }),
    person({ id: "sofia", display_name: "Sofia Reyes" }),
  ],
  next_cursor: null,
});

/** The People page's markup, as pages/admin-people.html has it. */
function page() {
  document.body.innerHTML = `
    <p id="status" role="status"></p>
    <input id="people-search" />
    <button id="add-person" class="button" hidden>Add a person</button>
    <ul id="people-list"></ul>
    <section id="person-details" hidden></section>`;
}

/**
 * The list button for one person.
 * @param {string} name
 */
function personButton(name) {
  const buttons = [...document.querySelectorAll("#people-list button")];
  const found = buttons.find((button) => button.textContent?.includes(name));
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no button for ${name}`);
  return found;
}

/**
 * A button in the details or a popup, by its words.
 * @param {string} selector where to look
 * @param {string} text
 */
function buttonCalled(selector, text) {
  const found = [...document.querySelectorAll(`${selector} button`)].find(
    (button) => button.textContent === text,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no button "${text}"`);
  return found;
}

/** The text of the details panel. */
const details = () => document.getElementById("person-details")?.textContent ?? "";

/** A promise with its resolve function, to hold an answer back until the test says so. */
function held() {
  /** @type {(response: Response) => void} */
  let release = () => {};
  /** @type {Promise<Response>} */
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("the People page", () => {
  it("throws away a slow answer for someone who is no longer chosen", async () => {
    // Ana's roles and lines are held back; everyone else's come at once.
    const anaRoles = held();
    const anaLines = held();
    server({
      "GET /api/users": () => json(200, people()),
      "GET /api/role-assignments": (url) =>
        url.includes("ana") ? anaRoles.promise : json(200, { items: [] }),
      "GET /api/reporting-lines": (url) =>
        url.includes("ana") ? anaLines.promise : json(200, { items: [] }),
    });
    page();
    await showPeople();

    // Choose Ana: her name shows at once, with a loading line and no account buttons yet.
    personButton("Ana").click();
    expect(details()).toContain("Ana Diaz");
    expect(details()).toContain("Loading");
    expect(document.querySelector("#person-details .person-actions")).toBeNull();

    // Then Priya and Sofia, before Ana's answers arrive; Sofia's are drawn.
    personButton("Priya").click();
    personButton("Sofia").click();
    await settle();
    expect(details()).toContain("Sofia Reyes");

    // Ana's answers arrive last: they must not replace Sofia's details or buttons.
    anaRoles.release(json(200, { items: [] }));
    anaLines.release(json(200, { items: [] }));
    await settle();
    expect(document.getElementById("person-name")?.textContent).toBe("Sofia Reyes");
    expect(details()).not.toContain("Ana Diaz");
    expect(personButton("Sofia").getAttribute("aria-pressed")).toBe("true");
    // Sofia is active, so hers is a Reset link; Ana's would have been a Setup link.
    expect(details()).toContain("Reset link");
    expect(details()).not.toContain("Setup link");
  });

  it("sends one link request however often the button is pressed", async () => {
    const link = held();
    server({
      "GET /api/users": () => json(200, people()),
      "POST /api/users/ana/setup-link": () => link.promise,
    });
    page();
    await showPeople();
    personButton("Ana").click();
    await settle();

    // A double click (and one more) while the first request is on its way.
    const setup = buttonCalled("#person-details", "Setup link");
    setup.click();
    setup.click();
    setup.click();
    expect(setup.getAttribute("aria-disabled")).toBe("true");
    const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts()).toHaveLength(1);

    // The answer arrives: one popup with the link. Once it is closed, the button works again.
    link.release(
      json(201, {
        purpose: "setup",
        link: "https://h/set-password.html#token=abc",
        expires_at: "2026-11-21T18:00:00Z",
      }),
    );
    await settle();
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    buttonCalled("dialog", "Done").click();
    await settle();
    expect(setup.hasAttribute("aria-disabled")).toBe(false);
  });

  // Choosing someone else and coming back draws new buttons; the guard must not be lost
  // with the old ones, or the second link would cancel the first one shown.
  it.each([
    { who: "Ana", id: "ana", label: "Setup link", purpose: "setup" },
    { who: "Sofia", id: "sofia", label: "Reset link", purpose: "reset" },
  ])(
    "sends one $label request when another person is chosen and then $who again",
    async ({ who, id, label, purpose }) => {
      const link = held();
      server({
        "GET /api/users": () => json(200, people()),
        [`POST /api/users/${id}/${purpose}-link`]: () => link.promise,
      });
      page();
      await showPeople();
      const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

      // Ask for a link; while it is on its way, choose Priya, then come back.
      personButton(who).click();
      await settle();
      buttonCalled("#person-details", label).click();
      personButton("Priya").click();
      await settle();
      personButton(who).click();
      await settle();

      // The button drawn again is off, and pressing it sends nothing.
      const again = buttonCalled("#person-details", label);
      expect(again.getAttribute("aria-disabled")).toBe("true");
      again.click();
      again.click();
      expect(posts()).toHaveLength(1);

      // The first answer arrives: one popup. Once it is closed, the new button works again.
      link.release(
        json(201, {
          purpose,
          link: "https://h/set-password.html#token=abc",
          expires_at: "2026-11-21T18:00:00Z",
        }),
      );
      await settle();
      expect(document.querySelectorAll("dialog")).toHaveLength(1);
      buttonCalled("dialog", "Done").click();
      await settle();
      expect(again.hasAttribute("aria-disabled")).toBe(false);
    },
  );

  it("says when roles could not be loaded, and leaves out only what was refused", async () => {
    server({
      "GET /api/users": () => json(200, people()),
      // Roles: a server error. Lines: refused (no right to see them), which is expected.
      "GET /api/role-assignments": () => json(500, { title: "Internal Server Error" }),
      "GET /api/reporting-lines": () => json(403, { title: "Forbidden" }),
    });
    page();
    await showPeople();
    personButton("Priya").click();
    await settle();
    const alerts = [...document.querySelectorAll("#person-details [role=alert]")].map(
      (alert) => alert.textContent,
    );
    expect(alerts).toEqual([expect.stringMatching(/^Their roles could not be loaded\./)]);
    expect(details()).not.toContain("Reporting lines");
  });

  it("says when lines could not be loaded because the server could not be reached", async () => {
    server({
      "GET /api/users": () => json(200, people()),
      "GET /api/reporting-lines": () => Promise.reject(new TypeError("Failed to fetch")),
    });
    page();
    await showPeople();
    personButton("Priya").click();
    await settle();
    expect(details()).toContain("Their reporting lines could not be loaded.");
  });

  it("says when the list of roles to give could not be loaded", async () => {
    server({
      "GET /api/users": () => json(200, people()),
      "GET /api/roles": () => json(503, { title: "Service Unavailable" }),
    });
    page();
    await showPeople();
    personButton("Priya").click();
    await settle();
    expect(details()).toContain("The list of roles to give could not be loaded.");
    expect(details()).not.toContain("Give a role");
  });

  it("keeps keyboard focus on the person chosen, though the list is drawn again", async () => {
    server({ "GET /api/users": () => json(200, people()) });
    page();
    await showPeople();
    const before = personButton("Priya");
    before.focus();
    before.click();
    // A new button for the same person, and it has the focus.
    const after = personButton("Priya");
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
    await settle();
    // "Back to the list" (for phones) returns to it from the details.
    after.blur();
    buttonCalled("#person-details", "Back to the list").click();
    expect(document.activeElement).toBe(personButton("Priya"));
  });

  it("tells a refusal from a failure", async () => {
    await expect(loadOrRefused(Promise.resolve([1]))).resolves.toEqual([1]);
    await expect(loadOrRefused(Promise.reject(new ApiError(403, {})))).resolves.toBeNull();
    await expect(loadOrRefused(Promise.reject(new ApiError(500, {})))).resolves.toBe(FAILED);
    await expect(loadOrRefused(Promise.reject(new NetworkError(null)))).resolves.toBe(FAILED);
    // A bug in our own code is not hidden.
    await expect(loadOrRefused(Promise.reject(new TypeError("bug")))).rejects.toThrow("bug");
  });
});

describe("email addresses in the form popup", () => {
  it("says so in plain words, before sending, when an address is not one", () => {
    const run = vi.fn();
    openFormDialog({
      title: "Add a person",
      submitLabel: "Add",
      fields: [{ name: "email", label: "Email", type: "email", value: "ana.example.com" }],
      run,
    });
    /** @type {HTMLFormElement} */ (document.querySelector("dialog form")).requestSubmit();
    expect(run).not.toHaveBeenCalled();
    expect(document.querySelector("dialog [role=alert]")?.textContent).toBe(INVALID_EMAIL);
  });

  it("never shows the server's pattern", () => {
    const refusal = new ApiError(422, {
      errors: [
        { location: "body.email", message: "String should match pattern '^[^@\\s]+@[^@\\s]+$'" },
        { location: "body.display_name", message: "String should have at most 200 characters" },
      ],
    });
    /** @type {import("../../js/components/form-dialog.js").Field[]} */
    const fields = [
      { name: "email", label: "Email", type: "email" },
      { name: "display_name", label: "Name", type: "text" },
    ];
    expect(explainFormFailure(refusal, fields)).toBe(
      `${INVALID_EMAIL} String should have at most 200 characters`,
    );
  });
});

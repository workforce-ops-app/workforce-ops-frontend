// The People screen's rules (search, plain-word labels, "Sent for approval to ..."), the
// API calls it makes, and the popups it uses: the form and the link shown once.
import { afterEach, describe, expect, it, vi } from "vitest";

// The page starts through the frame; these tests only use its exported rules.
vi.mock("../../js/components/app-shell.js", () => ({ startSignedInPage: vi.fn() }));
const { giveMessage, matches, scopeLabel, statusLabel } =
  await import("../../js/pages/admin-people.js");
const { giveRole, listLines } = await import("../../js/api/roles.js");
const { makeLink } = await import("../../js/api/users.js");
const { openFormDialog } = await import("../../js/components/form-dialog.js");
const { showLinkOnce } = await import("../../js/components/link-dialog.js");
const { ApiError } = await import("../../js/api/client.js");

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
      document.getElementById("form-dialog-field-display_name")
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
    expect(document.getElementById("form-dialog-field-scope_id")).toBeNull();
    const where = /** @type {HTMLSelectElement} */ (
      document.getElementById("form-dialog-field-scope_type")
    );
    where.value = "team";
    where.dispatchEvent(new Event("change"));
    expect(
      /** @type {HTMLSelectElement} */ (document.getElementById("form-dialog-field-scope_id"))
        .value,
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

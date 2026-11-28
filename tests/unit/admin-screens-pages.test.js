// The Departments and teams, Roles and owners, and Approvals pages run against their own
// HTML with a stand-in server: what they show after a change, after a change that stopped
// half way, and after a reload that failed (review of #93).
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPage } from "./page-html.js";

// The pages start through the frame; the tests start them themselves.
vi.mock("../../js/components/app-shell.js", () => ({ startSignedInPage: vi.fn() }));
// The signed-in person: "me", who holds every permission.
vi.mock("../../js/core/session.js", () => ({
  can: vi.fn(() => true),
  currentSession: vi.fn(() => ({ user: { id: "me" }, company: { timezone: "UTC" } })),
}));
const { showStructure, zoneChoices, memberChanges } =
  await import("../../js/pages/admin-structure.js");
const { ownerConsequence, ownersWhoMustAgree } = await import("../../js/pages/admin-roles.js");
const { describeRequest, showApprovals } = await import("../../js/pages/admin-approvals.js");
const { keepFocus, markStale, reportProblem } = await import("../../js/components/admin-page.js");
const { ApiError } = await import("../../js/api/client.js");

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** Let every pending promise and timer run (the pages load in several steps). */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * @typedef {(method: string, path: string, body: unknown) => [number, unknown?]} Route
 */

/**
 * A stand-in server: every request goes to `route`, which answers [status, body]. The
 * calls are kept, so a test can check what was sent.
 * @param {Route} route
 */
function server(route) {
  /** @type {{ method: string, path: string, body: unknown }[]} */
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
      const method = init.method ?? "GET";
      const path = String(url).split("?")[0];
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const [status, answer] = route(method, path, body);
      return Promise.resolve(
        status === 204
          ? new Response(null, { status })
          : new Response(JSON.stringify(answer ?? {}), {
              status,
              headers: { "Content-Type": "application/json" },
            }),
      );
    }),
  );
  return calls;
}

/** A list answer, as the API pages them. @param {unknown[]} items */
const page = (items) => ({ items, next_cursor: null });

/**
 * Someone in the Kitchen, in the given teams.
 * @param {string} id
 * @param {string} name
 * @param {string[]} [teamIds]
 * @returns {import("../../js/api/users.js").Person}
 */
function person(id, name, teamIds = []) {
  return {
    id,
    display_name: name,
    email: `${id}@northwind.example`,
    department_id: "d1",
    team_ids: teamIds,
    status: "active",
    locked: false,
    you_are_above: true,
  };
}

/** Click the button with this accessible name. @param {string} name */
function press(name) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  );
  if (!button) throw new Error(`no button "${name}"`);
  button.focus();
  button.click();
  return button;
}

/** Send the open popup's form. */
function submitForm() {
  /** @type {HTMLFormElement} */ (document.querySelector("dialog form")).requestSubmit();
}

const status = () => document.getElementById("status")?.textContent ?? "";

/**
 * Put a page's HTML in the document and show its main part, as the frame does once the
 * session has loaded (a hidden element cannot take focus).
 * @param {string} name
 */
function openPage(name) {
  loadPage(name);
  const main = document.querySelector("main");
  if (main) main.hidden = false;
}

describe("Departments and teams", () => {
  /**
   * The Kitchen with one team, Crew, whose members are Ana and Ben; Cy is in no team.
   * @param {Route} [changes] answers for anything but the three lists
   */
  function kitchen(changes = () => [204]) {
    const people = [person("ana", "Ana", ["t1"]), person("ben", "Ben", ["t1"]), person("cy", "Cy")];
    const calls = server((method, path, body) => {
      if (method === "GET" && path === "/api/departments")
        return [200, page([{ id: "d1", name: "Kitchen", timezone: "US/Eastern" }])];
      if (method === "GET" && path === "/api/teams")
        return [200, page([{ id: "t1", department_id: "d1", name: "Crew", archived: false }])];
      if (method === "GET" && path === "/api/users") return [200, page(people)];
      return changes(method, path, body);
    });
    return { calls, people };
  }

  it("clears 'Loading…' once the page has loaded (point 8)", async () => {
    openPage("admin-structure.html");
    kitchen();
    await showStructure();
    expect(status()).toBe("");
    expect(document.getElementById("department-list")?.textContent).toContain("Kitchen");
  });

  it("keeps a zone the browser's list lacks, and does not send it when unchanged (point 2)", async () => {
    // US/Eastern is an older name: not in the browser's list, but kept as its own choice.
    const choices = zoneChoices("UTC", "US/Eastern");
    expect(choices[0].value).toBe("");
    expect(choices[1]).toEqual({ value: "US/Eastern", label: "US/Eastern (current)" });
    expect(zoneChoices("UTC", "").some((c) => c.label.endsWith("(current)"))).toBe(false);

    openPage("admin-structure.html");
    const { calls } = kitchen((method) =>
      method === "PATCH" ? [200, { id: "d1", name: "Bakery", timezone: "US/Eastern" }] : [204],
    );
    await showStructure();
    press("Change Kitchen");
    const zone = /** @type {HTMLSelectElement} */ (document.querySelector("dialog select"));
    expect(zone.value).toBe("US/Eastern");
    // Rename only: the time zone must not be sent at all.
    const name = /** @type {HTMLInputElement} */ (document.querySelector("dialog input"));
    name.value = "Bakery";
    name.dispatchEvent(new Event("input"));
    submitForm();
    await settle();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ name: "Bakery" });
  });

  it("works out only the member changes still to make", () => {
    const team = { id: "t1", department_id: "d1", name: "Crew", archived: false };
    const people = [person("ana", "Ana", ["t1"]), person("ben", "Ben"), person("cy", "Cy")];
    const changes = memberChanges(team, people, new Set(), "ben");
    expect(changes.remove.map((p) => p.id)).toEqual(["ana"]);
    expect(changes.add?.id).toBe("ben");
    // Once Ana is out and Ben is in, nothing is left to do.
    people[0].team_ids = [];
    people[1].team_ids = ["t1"];
    expect(memberChanges(team, people, new Set(["ben"]), "ben")).toEqual({ remove: [], add: null });
  });

  it("after a save that stopped half way, says what was saved and retries only the rest (point 1)", async () => {
    openPage("admin-structure.html");
    // Removing Ana works; adding Cy is refused the first time, accepted the second.
    let addTries = 0;
    const { calls } = kitchen((method, path) => {
      if (method === "DELETE" && path === "/api/teams/t1/members/ana") return [204];
      if (method === "POST" && path === "/api/teams/t1/members") {
        addTries += 1;
        if (addTries === 1) return [409, { title: "Conflict", detail: "Cy is busy." }];
        return [204];
      }
      return [404, { title: "Not Found" }];
    });
    await showStructure();
    press("Members of Crew");
    // Untick Ana, choose Cy, save.
    const ana = /** @type {HTMLInputElement} */ (
      [...document.querySelectorAll("dialog input[type=checkbox]")].find(
        (box) => /** @type {HTMLInputElement} */ (box).value === "ana",
      )
    );
    ana.click();
    const add = /** @type {HTMLSelectElement} */ (document.querySelector("dialog select"));
    add.value = "cy";
    add.dispatchEvent(new Event("change"));
    submitForm();
    await settle();
    // The popup stays open and says Ana's removal was saved and why Cy was not added.
    const alert = document.querySelector("dialog [role=alert]")?.textContent ?? "";
    expect(alert).toContain("Already saved: Ana removed.");
    expect(alert).toContain("Cy is busy.");
    // Saving again sends only the add: Ana is not removed a second time (no 404).
    submitForm();
    await settle();
    const removals = calls.filter((c) => c.method === "DELETE");
    expect(removals).toHaveLength(1);
    expect(addTries).toBe(2);
    expect(document.querySelector("dialog")).toBeNull();
    expect(status()).toBe("Crew: Ana removed and Cy added.");
  });

  it("loads the list again when the popup is closed after a partial save (point 1)", async () => {
    openPage("admin-structure.html");
    const { calls } = kitchen((method) =>
      method === "DELETE" ? [204] : [409, { title: "Conflict", detail: "No." }],
    );
    await showStructure();
    press("Members of Crew");
    /** @type {HTMLInputElement} */ (document.querySelector("dialog input[type=checkbox]")).click();
    const add = /** @type {HTMLSelectElement} */ (document.querySelector("dialog select"));
    add.value = "cy";
    add.dispatchEvent(new Event("change"));
    submitForm();
    await settle();
    const before = calls.filter((c) => c.path === "/api/users").length;
    press("Go back");
    await settle();
    // The people were loaded again, and the status line says what was saved.
    expect(calls.filter((c) => c.path === "/api/users").length).toBe(before + 1);
    expect(status()).toBe("Crew: Ana removed.");
  });

  it("gives focus back to the rebuilt button after a change (point 7)", async () => {
    openPage("admin-structure.html");
    kitchen((method) =>
      method === "PATCH" ? [200, { id: "d1", name: "Kitchen", timezone: null }] : [204],
    );
    await showStructure();
    const opener = press("Change Kitchen");
    submitForm(); // nothing changed: still a save, and the list is drawn again
    await settle();
    const again = document.activeElement;
    expect(again).not.toBe(opener); // the old button is gone ...
    expect(again?.getAttribute("aria-label")).toBe("Change Kitchen"); // ... focus is on the new one
  });
});

describe("Roles and owners: who must agree (point 3)", () => {
  const me = { id: "me", display_name: "Mia" };
  const owen = { id: "owen", display_name: "Owen" };
  const pat = { id: "pat", display_name: "Pat" };

  it("removing the other of two owners takes effect at once, and they are not asked", () => {
    expect(ownersWhoMustAgree("remove", [me, owen], "me", "owen")).toEqual([]);
    expect(ownerConsequence("remove", [me, owen], "me", owen)).toBe(
      "This takes effect at once, as soon as your password is checked. Owen is not asked.",
    );
  });

  it("removing one of three needs the third, never the one removed", () => {
    expect(ownerConsequence("remove", [me, owen, pat], "me", owen)).toBe(
      "This takes effect only once Pat agrees. Owen is not asked. Your password is asked first.",
    );
  });

  it("removing yourself needs every other owner", () => {
    expect(ownerConsequence("remove", [me, owen], "me", me)).toBe(
      "This takes effect only once Owen agrees. Your password is asked first.",
    );
  });

  it("adding an owner needs every other owner, or happens at once for a sole owner", () => {
    expect(ownerConsequence("add", [me], "me")).toMatch(/^This takes effect at once/);
    expect(ownerConsequence("add", [me, owen, pat], "me")).toBe(
      "This takes effect only once Owen and Pat all agree. Your password is asked first.",
    );
  });
});

describe("Approvals", () => {
  /** @returns {import("../../js/api/approvals.js").ApprovalRequest} */
  function request(overrides = {}) {
    return {
      id: "q1",
      kind: "role_assignment",
      status: "pending",
      requested_by: "me",
      subject_user_id: "diego",
      payload: { role_id: "r1", scope_type: "employee", scope_id: "ben" },
      required_approvals: 1,
      review_by: "2026-11-26T18:00:00Z",
      not_reviewed: false,
      created_at: "2026-11-19T18:00:00Z",
      decided_at: null,
      reviewers: [{ id: "owner", display_name: "Owen" }],
      requested_by_name: "Marcus Lee",
      subject_name: "Diego Ruiz",
      role_name: "Shift Lead",
      scope_name: "Ben Ito",
      ...overrides,
    };
  }
  const places = { departments: new Map(), teams: new Map() };

  it("names the one person a role would be over (point 5)", () => {
    expect(describeRequest(request(), places)).toBe(
      "Marcus Lee asks to give Diego Ruiz the Shift Lead role, for Ben Ito only.",
    );
    // An API that does not name them yet: said plainly, never a guess.
    expect(describeRequest(request({ scope_name: undefined }), places)).toMatch(
      /for one person \(not named\)\.$/,
    );
    // The API's name for a department wins over the page's own list.
    const kitchen = request({
      payload: { role_id: "r1", scope_type: "department", scope_id: "d1" },
      scope_name: "Kitchen",
    });
    expect(describeRequest(kitchen, places)).toMatch(/for the Kitchen department\.$/);
  });

  it("after a decision, a failed reload is shown and the old buttons turned off (point 4)", async () => {
    openPage("admin-approvals.html");
    let cancelled = false;
    server((method, path) => {
      if (path === "/api/departments" || path === "/api/teams") return [200, page([])];
      if (method === "POST" && path === "/api/approval-requests/q1/cancel") {
        cancelled = true;
        return [200, request({ status: "cancelled" })];
      }
      if (path === "/api/approval-requests") {
        // The lists load the first time, and fail once the request is cancelled.
        if (cancelled) return [503, { title: "Service Unavailable", detail: "Try later." }];
        return [200, page([request()])];
      }
      return [404, { title: "Not Found" }];
    });
    await showApprovals();
    press("Cancel request");
    // The "Are you sure?" popup: confirm.
    /** @type {HTMLButtonElement} */ (document.querySelector("dialog .button--primary")).click();
    await settle();
    expect(status()).toMatch(/^Cancelled\. The page could not be loaded again \(Try later\.\)/);
    const stale = /** @type {HTMLButtonElement[]} */ ([
      ...document.querySelectorAll("#mine-list button"),
    ]);
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.every((b) => b.disabled)).toBe(true);
  });
});

describe("what the admin pages share", () => {
  it("says a change was saved even when the reload after it failed", () => {
    document.body.replaceChildren(Object.assign(document.createElement("p"), { id: "status" }));
    reportProblem(new ApiError(503, { title: "Service Unavailable", detail: "Down." }), "Saved.");
    expect(status()).toMatch(/^Saved\. The page could not be loaded again \(Down\.\)/);
    reportProblem(new ApiError(409, { title: "Conflict", detail: "No." }));
    expect(status()).toBe("Problem: No.");
  });

  it("turns off a stale list's buttons", () => {
    const list = Object.assign(document.createElement("ul"), { id: "l" });
    list.append(document.createElement("button"));
    document.body.replaceChildren(list);
    markStale("l");
    expect(/** @type {HTMLButtonElement} */ (list.firstElementChild).disabled).toBe(true);
  });

  it("puts focus on the heading when the focused button is gone, and leaves other focus alone", () => {
    const main = document.createElement("main");
    const heading = Object.assign(document.createElement("h1"), { textContent: "Approvals" });
    const gone = Object.assign(document.createElement("button"), { textContent: "Approve" });
    gone.dataset.key = "approve:q1";
    const search = document.createElement("input");
    main.append(heading, gone, search);
    document.body.replaceChildren(main);
    gone.focus();
    keepFocus(() => gone.remove());
    expect(document.activeElement).toBe(heading);
    // Focus the person moved elsewhere is not taken away.
    search.focus();
    keepFocus(() => {});
    expect(document.activeElement).toBe(search);
  });
});

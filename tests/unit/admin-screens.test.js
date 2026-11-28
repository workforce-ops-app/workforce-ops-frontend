// The Departments and teams, Roles and owners, and Approvals screens: their rules in plain
// words, the API calls they make, and the checkbox list in the form popup.
import { afterEach, describe, expect, it, vi } from "vitest";

// The pages start through the frame; these tests only use their exported rules.
vi.mock("../../js/components/app-shell.js", () => ({ startSignedInPage: vi.fn() }));
const { describeRequest, handledHere, outcome } = await import("../../js/pages/admin-approvals.js");
const { ownerMessage, permissionChoices, roleTag } = await import("../../js/pages/admin-roles.js");
const { membersOf, zoneChoices } = await import("../../js/pages/admin-structure.js");
const { decide } = await import("../../js/api/approvals.js");
const { addOwner, removeOwner } = await import("../../js/api/roles.js");
const { removeMember, updateDepartment } = await import("../../js/api/org.js");
const { openFormDialog } = await import("../../js/components/form-dialog.js");
const { joinNames } = await import("../../js/components/admin-page.js");

/** @type {import("vitest").Mock} */
let fetchMock;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/**
 * Answer every request with this JSON (or no body for 204).
 * @param {number} status
 * @param {unknown} [body]
 */
function answer(status, body) {
  fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
}

/** @returns {import("../../js/api/approvals.js").ApprovalRequest} */
function request(overrides = {}) {
  return {
    id: "q1",
    kind: "role_assignment",
    status: "pending",
    requested_by: "admin",
    subject_user_id: "chef",
    payload: { role_id: "r1", scope_type: "department", scope_id: "d1" },
    required_approvals: 1,
    review_by: "2026-11-26T18:00:00Z",
    not_reviewed: false,
    created_at: "2026-11-19T18:00:00Z",
    decided_at: null,
    reviewers: [{ id: "owner", display_name: "Owen" }],
    requested_by_name: "Ada",
    subject_name: "Chef",
    role_name: "Scheduler",
    ...overrides,
  };
}

const places = { departments: new Map([["d1", "Kitchen"]]), teams: new Map([["t1", "Crew"]]) };

describe("the Approvals screen's rules", () => {
  it("says what each kind of request asks for", () => {
    expect(describeRequest(request(), places)).toBe(
      "Ada asks to give Chef the Scheduler role, for the Kitchen department.",
    );
    const company = request({ payload: { role_id: "r1", scope_type: "company", scope_id: null } });
    expect(describeRequest(company, places)).toMatch(/for the whole company\.$/);
    expect(describeRequest(request({ kind: "owner_add" }), places)).toBe(
      "Ada proposes making Chef an owner of the company.",
    );
    expect(describeRequest(request({ kind: "owner_remove" }), places)).toBe(
      "Ada proposes that Chef stop being an owner of the company.",
    );
  });

  it("shows names as text, never as HTML", () => {
    const text = describeRequest(request({ subject_name: "<img src=x onerror=alert(1)>" }), places);
    const node = document.createElement("p");
    node.textContent = text;
    expect(node.querySelector("img")).toBeNull();
  });

  it("says what became of a request", () => {
    expect(outcome(request(), "America/Chicago")).toMatch(
      /^Waiting for Owen\. Declined on .+ if nobody decides\.$/,
    );
    expect(outcome(request({ reviewers: [] }), "UTC")).toMatch(/^Nobody can review it right now/);
    expect(outcome(request({ status: "denied", not_reviewed: true }), "UTC")).toBe(
      "Declined: nobody decided in time.",
    );
    expect(outcome(request({ status: "approved" }), "UTC")).toBe("Approved.");
  });

  it("leaves time-off requests to their own screens", () => {
    const kept = handledHere([request(), request({ id: "t", kind: "time_off" })]);
    expect(kept.map((r) => r.id)).toEqual(["q1"]);
  });
});

describe("the Roles and owners screen's rules", () => {
  const all = [
    { code: "schedule.edit", kind: "record", description: "Edit shifts" },
    { code: "user.manage", kind: "person", description: "Manage accounts" },
    { code: "audit.view", kind: "company", description: "See the audit log" },
  ];

  it("offers only what the person holds, and locks what the role has that they lack", () => {
    const holds = (/** @type {string} */ code) => code !== "audit.view" && code !== "user.manage";
    expect(permissionChoices(all, ["user.manage"], holds)).toEqual([
      { value: "schedule.edit", label: "Edit shifts (schedule.edit)", locked: false },
      { value: "user.manage", label: "Manage accounts (user.manage)", locked: true },
    ]);
  });

  it("says whether an owner change happened or waits", () => {
    expect(ownerMessage({ done: true, owners: [] }, "Done.")).toBe("Done.");
    const waiting = {
      done: /** @type {const} */ (false),
      request: {
        id: "q",
        kind: "owner_add",
        status: "pending",
        reviewers: [{ id: "b", display_name: "Bea" }],
      },
    };
    expect(ownerMessage(waiting, "Done.")).toMatch(/^Sent for approval to Bea\./);
  });

  it("tags built-in and archived roles", () => {
    const role = {
      id: "r",
      name: "X",
      built_in: null,
      archived: false,
      permissions: [],
      you_may_change: true,
    };
    expect(roleTag(role)).toBe("");
    expect(roleTag({ ...role, built_in: "manager" })).toBe("Built in");
    expect(roleTag({ ...role, archived: true })).toMatch(/^Archived/);
  });

  it("joins names for a sentence", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("the Departments and teams screen's rules", () => {
  it("lists a team's members by name", () => {
    /** @param {string} name @param {string[]} teams */
    const p = (name, teams) => ({
      id: name,
      display_name: name,
      email: "",
      department_id: "d1",
      team_ids: teams,
      status: /** @type {const} */ ("active"),
      locked: false,
      you_are_above: true,
    });
    const team = { id: "t1", department_id: "d1", name: "Crew", archived: false };
    expect(
      membersOf(team, [p("Zed", ["t1"]), p("Amy", ["t1"]), p("Bo", [])]).map((m) => m.id),
    ).toEqual(["Amy", "Zed"]);
  });

  it("offers the company's time zone first", () => {
    expect(zoneChoices("America/Chicago")[0]).toEqual({
      value: "",
      label: "The company's (America/Chicago)",
    });
  });
});

describe("the API calls", () => {
  it("tells an owner change made at once from one waiting for the other owners", async () => {
    answer(200, { items: [{ id: "u2", display_name: "Bea" }] });
    expect(await addOwner("u2")).toEqual({
      done: true,
      owners: [{ id: "u2", display_name: "Bea" }],
    });
    answer(202, { id: "q", kind: "owner_remove", status: "pending", reviewers: [] });
    expect(await removeOwner("u/2")).toMatchObject({ done: false, request: { id: "q" } });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/owners/u%2F2/remove");
  });

  it("keeps IDs from bending the address", async () => {
    answer(200, { id: "q" });
    await decide("../x", "approve");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/approval-requests/..%2Fx/approve");
    answer(200, { id: "d" });
    await updateDepartment("a?b", { timezone: null });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/departments/a%3Fb");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ timezone: null });
    answer(204);
    await removeMember("t/1", "u#2");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/teams/t%2F1/members/u%232");
  });
});

describe("the checkbox list in the form popup", () => {
  it("sends the ticked values, and a locked one cannot be changed", async () => {
    const run = vi.fn().mockResolvedValue("saved");
    const result = openFormDialog({
      title: "Change Manager",
      submitLabel: "Save",
      fields: [
        {
          name: "permissions",
          label: "What it allows",
          type: "checks",
          value: "audit.view",
          options: [
            { value: "schedule.edit", label: "Edit shifts" },
            { value: "audit.view", label: "See the audit log", locked: true },
          ],
        },
      ],
      run,
    });
    const [edit, audit] = /** @type {HTMLInputElement[]} */ ([
      ...document.querySelectorAll("dialog input[type=checkbox]"),
    ]);
    expect(audit.checked && audit.disabled).toBe(true);
    expect(document.querySelector(`label[for="${edit.id}"]`)?.textContent).toBe("Edit shifts");
    edit.click();
    /** @type {HTMLFormElement} */ (document.querySelector("dialog form")).requestSubmit();
    await expect(result).resolves.toBe("saved");
    expect(run).toHaveBeenCalledWith({ permissions: "audit.view schedule.edit" });
  });
});

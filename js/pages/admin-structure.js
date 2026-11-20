// Departments and teams (pages/admin-structure.html; docs/features/administration.md).
//
// Each active department, with its time zone (the company's unless set), its teams, and
// who is in each team. With org.manage: add, rename, and archive departments and teams,
// change a department's time zone, and add or remove team members. Archiving is refused
// while a department still has people or teams; the API says why, and the page shows it.
//
// Each department also shows its send-up minimum for time off with coworkers' offers
// (docs/features/coverage.md): how many days before the time off a collecting request goes
// to the managers. Its managers, and people reviewing time off company-wide, may raise it
// (never below the company's); with several managers the change waits until every other
// one confirms it on the Approvals screen, and the card says who it waits for.
//
// Display only: the API checks org.manage (and the department's managers) on every change.

import { listDepartments } from "../api/shifts.js";
import { ApiError } from "../api/client.js";
import {
  addMember,
  archiveDepartment,
  archiveTeam,
  changeDepartmentSetting,
  createDepartment,
  createTeam,
  departmentSettings,
  listTeams,
  removeMember,
  renameTeam,
  updateDepartment,
} from "../api/org.js";
import { listPeople } from "../api/users.js";
import { actionButton, reportProblem, say } from "../components/admin-page.js";
import { startSignedInPage } from "../components/app-shell.js";
import { confirmChange } from "../components/confirm-dialog.js";
import { openFormDialog } from "../components/form-dialog.js";
import { el } from "../core/dom.js";
import { can, currentSession } from "../core/session.js";
import { joinNames } from "../components/admin-page.js";

/** @typedef {import("../api/org.js").Team} Team */
/** @typedef {import("../api/users.js").Person} Person */
/** @typedef {{ id: string, name: string }} Named */
/** @typedef {Named & { timezone?: string | null }} DepartmentRow */
/** @typedef {import("../api/org.js").DepartmentSetting} DepartmentSetting */

// --- Small rules, exported for the tests --------------------------------------------------

/**
 * The members of a team, by name.
 * @param {Team} team
 * @param {Person[]} people
 */
export function membersOf(team, people) {
  return people
    .filter((p) => p.team_ids.includes(team.id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/**
 * The time zones to choose from: the company's (no zone of its own), then every zone the
 * browser knows.
 * @param {string} companyZone
 */
export function zoneChoices(companyZone) {
  const known =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [
    { value: "", label: `The company's (${companyZone})` },
    ...known.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") })),
  ];
}

/** "1 day", "3 days". @param {number} n */
export function daysWord(n) {
  return n === 1 ? "1 day" : `${n} days`;
}

/**
 * The send-up minimum in words, with any change still waiting for the other managers.
 * @param {DepartmentSetting} setting
 */
export function minimumText(setting) {
  const own =
    setting.department_value !== null && setting.department_value > setting.company_value
      ? `this department's own (the company's is ${daysWord(setting.company_value)})`
      : "the company's";
  const line = `Time off with coworkers' offers goes to the managers at least ${daysWord(setting.value)} before it starts: ${own}.`;
  if (!setting.pending) return line;
  const who = setting.pending.waiting_for;
  return `${line} A change to ${daysWord(setting.pending.value)} is waiting for ${who.length ? joinNames(who) : "the other managers"} to confirm.`;
}

/**
 * The values a department may choose: from the company's up to the limit.
 * @param {DepartmentSetting} setting
 */
export function minimumChoices(setting) {
  const choices = [];
  for (let n = setting.company_value; n <= setting.limit; n += 1) {
    choices.push({
      value: String(n),
      label: n === setting.company_value ? `${daysWord(n)} (the company's)` : daysWord(n),
    });
  }
  return choices;
}

// --- The page ----------------------------------------------------------------------------

/**
 * @type {{ departments: DepartmentRow[], teams: Team[], people: Person[],
 *   minimums: Map<string, DepartmentSetting> }}
 *   minimums: the send-up minimum of each department this person may manage it for
 */
const state = { departments: [], teams: [], people: [], minimums: new Map() };

/**
 * A request the API may refuse for this person (403, 404): the screen goes without it.
 * @template T
 * @param {Promise<T>} call
 * @param {T} otherwise
 * @returns {Promise<T>}
 */
async function orWithout(call, otherwise) {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return otherwise;
    }
    throw error;
  }
}

/**
 * The send-up minimum of each department, where this person may see it.
 * @param {DepartmentRow[]} departments
 */
async function loadMinimums(departments) {
  const found = await Promise.all(
    departments.map(async (department) => {
      const settings = await orWithout(departmentSettings(department.id), []);
      const minimum = settings.find((s) => s.key === "offers_close_days");
      return /** @type {const} */ ([department.id, minimum]);
    }),
  );
  return new Map(
    found.flatMap(([id, minimum]) =>
      minimum ? [/** @type {[string, DepartmentSetting]} */ ([id, minimum])] : [],
    ),
  );
}

function companyZone() {
  return currentSession()?.company.timezone ?? "UTC";
}

export async function showStructure() {
  document
    .getElementById("add-department")
    ?.addEventListener("click", () => departmentDialog(null));
  await reload();
}

async function reload() {
  try {
    // Managers without org.manage reach this screen for the minimum: whatever the API
    // refuses them is left out, and the page shows the rest.
    const [departments, teams, people] = await Promise.all([
      listDepartments(),
      orWithout(listTeams(), []),
      orWithout(listPeople(), []),
    ]);
    const minimums = await loadMinimums(departments);
    Object.assign(state, { departments, teams, people, minimums });
  } catch (error) {
    reportProblem(error);
    return;
  }
  draw();
}

function draw() {
  const list = document.getElementById("department-list");
  if (!list) return;
  const manage = can("org.manage");
  list.replaceChildren(
    ...[...state.departments]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((department) => {
        const teams = state.teams
          .filter((t) => t.department_id === department.id && !t.archived)
          .sort((a, b) => a.name.localeCompare(b.name));
        /** @type {HTMLElement[]} */
        const buttons = [];
        if (manage) {
          buttons.push(
            actionButton("Change", () => departmentDialog(department), {
              ariaLabel: `Change ${department.name}`,
            }),
            actionButton("Add a team", () => teamDialog(department.id, null), {
              ariaLabel: `Add a team to ${department.name}`,
            }),
            actionButton("Archive", () => archive("department", department), {
              className: "button button--danger-outline",
              ariaLabel: `Archive ${department.name}`,
            }),
          );
        }
        const zone = department.timezone;
        const minimum = state.minimums.get(department.id);
        return el("li", { className: "request-card" }, [
          el("h2", { className: "role-card__name", text: department.name }),
          el("p", {
            className: "muted",
            text: `Time zone: ${zone ? zone.replaceAll("_", " ") : `the company's (${companyZone()})`}`,
          }),
          el("div", { className: "person-actions" }, buttons),
          ...(minimum ? minimumSection(department, minimum) : []),
          el("h3", { text: "Teams" }),
          teams.length
            ? el(
                "ul",
                { className: "person-rows" },
                teams.map((team) => teamRow(team, manage)),
              )
            : el("p", { className: "muted", text: "No teams." }),
        ]);
      }),
  );
}

/**
 * The send-up minimum on a department's card, with its Change button (none while a
 * change already waits: the API would answer 409).
 * @param {DepartmentRow} department
 * @param {DepartmentSetting} minimum
 * @returns {HTMLElement[]}
 */
function minimumSection(department, minimum) {
  return [
    el("h3", { text: "Swaps and coverage" }),
    el("p", { className: "muted", text: minimumText(minimum) }),
    ...(minimum.pending || minimum.company_value >= minimum.limit
      ? []
      : [
          el("div", { className: "person-actions" }, [
            actionButton("Change minimum", () => minimumDialog(department, minimum), {
              ariaLabel: `Change the send-up minimum of ${department.name}`,
            }),
          ]),
        ]),
  ];
}

/**
 * Ask for the new minimum, send it, and say what happened: in force now, or waiting for
 * the other managers (202).
 * @param {DepartmentRow} department
 * @param {DepartmentSetting} minimum
 */
async function minimumDialog(department, minimum) {
  const changed = await openFormDialog({
    title: `Send-up minimum for ${department.name}`,
    lead: "Time off with coworkers' offers goes to the managers at least this many days before it starts. Never fewer than the company's.",
    submitLabel: "Save",
    fields: [
      {
        name: "value",
        label: "Days before",
        type: "select",
        value: String(minimum.value),
        options: minimumChoices(minimum),
      },
    ],
    run: (values) => changeDepartmentSetting(department.id, minimum.key, Number(values.value)),
  });
  if (!changed) return;
  say(
    changed.approval_request_id
      ? `${department.name}: the change waits for the department's other managers to confirm it on the Approvals screen.`
      : `${department.name}: time off with coworkers' offers now goes up at least ${daysWord(changed.value ?? minimum.value)} before.`,
  );
  await reload();
}

/**
 * One team: its members, and (with org.manage) its buttons.
 * @param {Team} team
 * @param {boolean} manage
 */
function teamRow(team, manage) {
  const members = membersOf(team, state.people);
  const names = members.map((p) => p.display_name).join(", ") || "Nobody yet";
  const children = [
    el("div", {}, [
      el("strong", { text: team.name }),
      el("span", { className: "muted", text: ` · ${names}` }),
    ]),
  ];
  if (manage) {
    children.push(
      el("div", { className: "person-actions" }, [
        actionButton("Members", () => membersDialog(team), {
          className: "button button--small",
          ariaLabel: `Members of ${team.name}`,
        }),
        actionButton("Rename", () => teamDialog(team.department_id, team), {
          className: "button button--small",
          ariaLabel: `Rename ${team.name}`,
        }),
        actionButton("Archive", () => archive("team", team), {
          className: "button button--small",
          ariaLabel: `Archive ${team.name}`,
        }),
      ]),
    );
  }
  return el("li", { className: "person-row" }, children);
}

/** @param {DepartmentRow | null} department null: a new one */
async function departmentDialog(department) {
  const current = department?.timezone ?? "";
  const saved = await openFormDialog({
    title: department ? `Change ${department.name}` : "Add a department",
    submitLabel: department ? "Save" : "Add",
    fields: [
      { name: "name", label: "Name", type: "text", value: department?.name ?? "", required: true },
      {
        name: "timezone",
        label: "Time zone",
        type: "select",
        value: current,
        hint: "Shift times in this department are shown in this zone.",
        options: zoneChoices(companyZone()),
      },
    ],
    run: (values) => {
      const timezone = values.timezone || null;
      if (!department) return createDepartment({ name: values.name, timezone });
      /** @type {{ name?: string, timezone?: string | null }} */
      const changes = {};
      if (values.name !== department.name) changes.name = values.name;
      if (values.timezone !== current) changes.timezone = timezone;
      return updateDepartment(department.id, changes);
    },
  });
  if (!saved) return;
  say(`${saved.name} saved.`);
  await reload();
}

/**
 * @param {string} departmentId
 * @param {Team | null} team null: a new one
 */
async function teamDialog(departmentId, team) {
  const saved = await openFormDialog({
    title: team ? `Rename ${team.name}` : "Add a team",
    submitLabel: team ? "Save" : "Add",
    fields: [
      { name: "name", label: "Name", type: "text", value: team?.name ?? "", required: true },
    ],
    run: (values) =>
      team ? renameTeam(team.id, values.name) : createTeam(departmentId, values.name),
  });
  if (!saved) return;
  say(`${saved.name} saved.`);
  await reload();
}

/**
 * Add someone to a team, or remove a member.
 * @param {Team} team
 */
async function membersDialog(team) {
  const members = membersOf(team, state.people);
  const others = state.people
    .filter((p) => p.status !== "deactivated" && !p.team_ids.includes(team.id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const changed = await openFormDialog({
    title: `Members of ${team.name}`,
    submitLabel: "Save",
    fields: [
      {
        name: "add",
        label: "Add",
        type: "select",
        options: [
          { value: "", label: "Nobody" },
          ...others.map((p) => ({ value: p.id, label: p.display_name })),
        ],
      },
      {
        name: "keep",
        label: "Members (untick to remove)",
        type: "checks",
        value: members
          .map((p) => p.id)
          .sort()
          .join(" "),
        options: members.map((p) => ({ value: p.id, label: p.display_name })),
        shown: () => members.length > 0,
      },
    ],
    run: async (values) => {
      const keep = new Set(values.keep?.split(" ").filter(Boolean));
      // One request per change; a failure stops here and the form shows it.
      for (const member of members) {
        if (!keep.has(member.id)) await removeMember(team.id, member.id);
      }
      if (values.add) await addMember(team.id, values.add);
      return true;
    },
  });
  if (!changed) return;
  say(`${team.name} saved.`);
  await reload();
}

/**
 * @param {"department" | "team"} what
 * @param {Named} item
 */
async function archive(what, item) {
  const done = await confirmChange({
    title: `Archive ${item.name}?`,
    message:
      what === "department"
        ? "It disappears from the lists. Its past shifts are kept. A department with people or teams cannot be archived."
        : "It disappears from the lists, and its members are no longer in it.",
    confirmLabel: "Archive",
    run: () => (what === "department" ? archiveDepartment(item.id) : archiveTeam(item.id)),
  });
  if (!done) return;
  say(`${item.name} archived.`);
  await reload();
}

// Load the session first (signed-out visitors go to the sign-in page), then the page.
if (document.getElementById("department-list")) {
  startSignedInPage(() => showStructure());
}

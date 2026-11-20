// Departments and teams (pages/admin-structure.html; docs/features/administration.md).
//
// Each active department, with its time zone (the company's unless set), its teams, and
// who is in each team. With org.manage: add, rename, and archive departments and teams,
// change a department's time zone, and add or remove team members. Archiving is refused
// while a department still has people or teams; the API says why, and the page shows it.
//
// Display only: the API checks org.manage on every change regardless.

import { listDepartments } from "../api/shifts.js";
import {
  addMember,
  archiveDepartment,
  archiveTeam,
  createDepartment,
  createTeam,
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

/** @typedef {import("../api/org.js").Team} Team */
/** @typedef {import("../api/users.js").Person} Person */
/** @typedef {{ id: string, name: string }} Named */
/** @typedef {Named & { timezone?: string | null }} DepartmentRow */

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

// --- The page ----------------------------------------------------------------------------

/** @type {{ departments: DepartmentRow[], teams: Team[], people: Person[] }} */
const state = { departments: [], teams: [], people: [] };

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
    const [departments, teams, people] = await Promise.all([
      listDepartments(),
      listTeams(),
      listPeople(),
    ]);
    Object.assign(state, { departments, teams, people });
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
        return el("li", { className: "request-card" }, [
          el("h2", { className: "role-card__name", text: department.name }),
          el("p", {
            className: "muted",
            text: `Time zone: ${zone ? zone.replaceAll("_", " ") : `the company's (${companyZone()})`}`,
          }),
          el("div", { className: "person-actions" }, buttons),
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

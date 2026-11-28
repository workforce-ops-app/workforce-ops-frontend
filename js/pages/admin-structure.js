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
import {
  actionButton,
  joinNames,
  keepFocus,
  markStale,
  reportProblem,
  say,
} from "../components/admin-page.js";
import { startSignedInPage } from "../components/app-shell.js";
import { confirmChange } from "../components/confirm-dialog.js";
import { openFormDialog } from "../components/form-dialog.js";
import { PartlySaved } from "../components/modal.js";
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
 * The time zones to choose from: the company's (no zone of its own), then the
 * department's current zone if the browser's list lacks it, then every zone the browser
 * knows.
 *
 * The browser's list holds only the main name of each zone ("America/New_York"), not the
 * older names the server also accepts ("US/Eastern", "UTC", "Etc/UTC"). A department
 * saved with one of those must keep it: without its own choice the select would fall back
 * to the company's zone, and saving a new name would quietly send `timezone: null` (review
 * of #93, point 2).
 * @param {string} companyZone
 * @param {string} [current] the department's zone now ("" or missing: the company's)
 */
export function zoneChoices(companyZone, current = "") {
  // Every zone this browser knows (an older browser without the list offers none).
  const known =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  // The current zone, kept as a choice of its own when the list does not have it.
  const kept =
    current && !known.includes(current)
      ? [{ value: current, label: `${current.replaceAll("_", " ")} (current)` }]
      : [];
  return [
    { value: "", label: `The company's (${companyZone})` },
    ...kept,
    ...known.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") })),
  ];
}

/**
 * The team-member changes still to send: who to remove (a member whose box was unticked)
 * and who to add, worked out from the people as they are now. Worked out again on every
 * save, so after a save that stopped half way, saving again sends only what is left and
 * never repeats a change already made (review of #93, point 1).
 * @param {Team} team
 * @param {Person[]} people
 * @param {Set<string>} keep the members whose boxes are still ticked
 * @param {string} add the person chosen to add ("" for nobody)
 * @returns {{ remove: Person[], add: Person | null }}
 */
export function memberChanges(team, people, keep, add) {
  // Members now whose box was unticked.
  const remove = membersOf(team, people).filter((p) => !keep.has(p.id));
  // The person to add, unless they are in the team already (added by the last try).
  const adding = people.find((p) => p.id === add && !p.team_ids.includes(team.id)) ?? null;
  return { remove, add: adding };
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

/**
 * Load everything again and draw the list.
 *
 * On success the status line says `done` (what was just saved), or nothing at all on the
 * first load, which also clears the page's "Loading…" (review of #93, point 8). On failure
 * the change in `done` was still saved: the line says so, and the old list's buttons are
 * turned off because they act on what may no longer be true (point 4).
 * @param {string} [done] what was just saved
 */
async function reload(done = "") {
  try {
    // The three lists at once: departments, their teams, and the people in the teams.
    const [departments, teams, people] = await Promise.all([
      listDepartments(),
      listTeams(),
      listPeople(),
    ]);
    Object.assign(state, { departments, teams, people });
  } catch (error) {
    markStale("department-list");
    reportProblem(error, done);
    return;
  }
  // Drawn so keyboard focus comes back to the button that opened the popup (point 7).
  keepFocus(draw);
  say(done);
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
          // Each button has a key, so focus can come back to it after the list is drawn
          // again (keepFocus).
          buttons.push(
            actionButton("Change", () => departmentDialog(department), {
              ariaLabel: `Change ${department.name}`,
              key: `department-change:${department.id}`,
            }),
            actionButton("Add a team", () => teamDialog(department.id, null), {
              ariaLabel: `Add a team to ${department.name}`,
              key: `department-add-team:${department.id}`,
            }),
            actionButton("Archive", () => archive("department", department), {
              className: "button button--danger-outline",
              ariaLabel: `Archive ${department.name}`,
              key: `department-archive:${department.id}`,
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
    el("div", { className: "person-row__text" }, [
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
          key: `team-members:${team.id}`,
        }),
        actionButton("Rename", () => teamDialog(team.department_id, team), {
          className: "button button--small",
          ariaLabel: `Rename ${team.name}`,
          key: `team-rename:${team.id}`,
        }),
        actionButton("Archive", () => archive("team", team), {
          className: "button button--small",
          ariaLabel: `Archive ${team.name}`,
          key: `team-archive:${team.id}`,
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
        // The current zone is always one of the choices, so it stays selected (point 2).
        options: zoneChoices(companyZone(), current),
      },
    ],
    run: (values) => {
      const timezone = values.timezone || null;
      if (!department) return createDepartment({ name: values.name, timezone });
      // Only what changed is sent: an unchanged time zone is not sent at all.
      /** @type {{ name?: string, timezone?: string | null }} */
      const changes = {};
      if (values.name !== department.name) changes.name = values.name;
      if (values.timezone !== current) changes.timezone = timezone;
      return updateDepartment(department.id, changes);
    },
  });
  if (!saved) return;
  await reload(`${saved.name} saved.`);
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
  await reload(`${saved.name} saved.`);
}

/**
 * Add someone to a team, or remove members.
 *
 * Each change is its own request, so a save can stop half way: Ana removed, then adding
 * Ben refused. What happens then (review of #93, point 1):
 *   - every change that worked is written into the page's own list of people at once, so
 *     saving again works out the changes left (memberChanges) and never repeats one that
 *     was made (which the server would answer with 404);
 *   - the popup stays open and says what was saved and why the rest was not;
 *   - once the popup closes, saved or not, the list is loaded again if anything changed,
 *     so it (and the popup, opened again) shows the members as they are.
 * @param {Team} team
 */
async function membersDialog(team) {
  const members = membersOf(team, state.people);
  const others = state.people
    .filter((p) => p.status !== "deactivated" && !p.team_ids.includes(team.id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  /** @type {string[]} every change saved while the popup was open, in plain words */
  const saved = [];
  await openFormDialog({
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
      // Step 1: what is left to do, from the people as they are now (after any earlier
      // try that stopped half way).
      const keep = new Set(values.keep?.split(" ").filter(Boolean));
      const changes = memberChanges(team, state.people, keep, values.add);
      /** @type {string[]} the changes this try saved */
      const now = [];
      try {
        // Step 2: one request per change. After each one that worked, the person's teams
        // are updated here too, so a later try does not send it again.
        for (const member of changes.remove) {
          await removeMember(team.id, member.id);
          member.team_ids = member.team_ids.filter((id) => id !== team.id);
          now.push(`${member.display_name} removed`);
        }
        if (changes.add) {
          await addMember(team.id, changes.add.id);
          changes.add.team_ids = [...changes.add.team_ids, team.id];
          now.push(`${changes.add.display_name} added`);
        }
      } catch (error) {
        // Step 3: a request failed. Anything this try saved is said first ("Already saved:
        // Ana removed.") and the server's reason after it; the popup stays open, and
        // saving again tries only what is left.
        saved.push(...now);
        if (now.length) {
          throw new PartlySaved(
            `Already saved: ${joinNames(now)}. The rest was not saved, and Save tries it again:`,
            error,
          );
        }
        throw error;
      }
      saved.push(...now);
      return true;
    },
  });
  // Load the list again whenever something changed, even if the popup was closed with
  // "Go back" after a save that stopped half way.
  if (saved.length === 0) return;
  await reload(`${team.name}: ${joinNames(saved)}.`);
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
  await reload(`${item.name} archived.`);
}

// Load the session first (signed-out visitors go to the sign-in page), then the page.
if (document.getElementById("department-list")) {
  startSignedInPage(() => showStructure());
}

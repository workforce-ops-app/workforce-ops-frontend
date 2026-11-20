// Roles and owners (pages/admin-roles.html; docs/features/administration.md).
//
// Roles: every role of the company and what it grants. With role.manage the person can
// create a role, and change or archive one, but only where the API says
// `you_may_change` (rule AZ13: they are above every holder, or an owner; never the Owner
// role, never an archived one). A role can only grant what the person holds themselves
// (AZ3), so the permission list offers only those; one the role already grants that they
// lack is shown locked, and stays as it is.
//
// Owners: who owns the company. Only an owner (company.transfer_ownership) proposes a
// change; every other owner must agree, so the answer is either "Done" or "Sent for
// approval to ...". Never the last owner (the API refuses, and says so).
//
// Changing what a role grants, archiving one, and any owner change ask for the password
// again: the API client shows the pop-up and repeats the request (reauth-dialog.js).
// Display only: the API checks every request regardless (threats E2, E6, E9).

import { listPeople } from "../api/users.js";
import {
  addOwner,
  archiveRole,
  createRole,
  listOwners,
  listPermissions,
  listRoles,
  removeOwner,
  updateRole,
} from "../api/roles.js";
import { actionButton, joinNames, reportProblem, say } from "../components/admin-page.js";
import { startSignedInPage } from "../components/app-shell.js";
import { confirmChange } from "../components/confirm-dialog.js";
import { openFormDialog } from "../components/form-dialog.js";
import { el } from "../core/dom.js";
import { can, currentSession } from "../core/session.js";

/** @typedef {import("../api/roles.js").Role} Role */
/** @typedef {import("../api/roles.js").Permission} Permission */
/** @typedef {import("../api/roles.js").OwnerResult} OwnerResult */

// --- Small rules, exported for the tests --------------------------------------------------

/**
 * The permissions to offer for a role: every one the person holds, plus the ones the
 * role already grants that they lack, shown locked (AZ3: they cannot add or remove those).
 * @param {Permission[]} all
 * @param {string[]} granted what the role grants now
 * @param {(code: string) => boolean} holds
 */
export function permissionChoices(all, granted, holds) {
  return all
    .filter((p) => holds(p.code) || granted.includes(p.code))
    .map((p) => ({ value: p.code, label: `${p.description} (${p.code})`, locked: !holds(p.code) }));
}

/**
 * What to say after an owner change.
 * @param {OwnerResult} result
 * @param {string} done what happened, if it happened at once
 */
export function ownerMessage(result, done) {
  if (result.done) return done;
  const names = result.request.reviewers.map((r) => r.display_name);
  return `Sent for approval to ${joinNames(names) || "the other owners"}. It takes effect once every other owner agrees.`;
}

/**
 * The words for a built-in role.
 * @param {Role} role
 */
export function roleTag(role) {
  if (role.archived) return "Archived: grants nothing";
  return role.built_in ? "Built in" : "";
}

// --- The page ----------------------------------------------------------------------------

/** @type {{ roles: Role[], permissions: Permission[], people: import("../api/users.js").Person[] }} */
const state = { roles: [], permissions: [], people: [] };

export async function showRoles() {
  try {
    const [roles, permissions, people] = await Promise.all([
      listRoles(),
      can("role.manage") ? listPermissions() : Promise.resolve([]),
      can("company.transfer_ownership") ? listPeople() : Promise.resolve([]),
    ]);
    Object.assign(state, { roles, permissions, people });
  } catch (error) {
    reportProblem(error);
    return;
  }
  say("");
  document.getElementById("new-role")?.addEventListener("click", () => roleDialog(null));
  drawRoles();
  await drawOwners();
}

async function reloadRoles() {
  try {
    state.roles = await listRoles();
  } catch (error) {
    reportProblem(error);
    return;
  }
  drawRoles();
}

function drawRoles() {
  const list = document.getElementById("role-list");
  if (!list) return;
  const manage = can("role.manage");
  const described = new Map(state.permissions.map((p) => [p.code, p.description]));
  list.replaceChildren(
    ...state.roles.map((role) => {
      const tag = roleTag(role);
      const grants = role.permissions.map((code) => described.get(code) ?? code);
      /** @type {HTMLElement[]} */
      const buttons = [];
      if (manage && role.you_may_change) {
        buttons.push(
          actionButton("Change", () => roleDialog(role), { ariaLabel: `Change ${role.name}` }),
          actionButton("Archive", () => archive(role), {
            className: "button button--danger-outline",
            ariaLabel: `Archive ${role.name}`,
          }),
        );
      }
      return el("li", { className: "request-card" }, [
        el("h3", { className: "role-card__name", text: role.name }),
        ...(tag ? [el("p", { className: "muted", text: tag })] : []),
        el("details", {}, [
          el("summary", { text: `Grants ${role.permissions.length} permission(s)` }),
          el(
            "ul",
            {},
            grants.map((text) => el("li", { text })),
          ),
        ]),
        ...(manage && !role.you_may_change && !role.archived
          ? [
              el("p", {
                className: "muted",
                text:
                  role.built_in === "owner"
                    ? "The Owner role never changes."
                    : "Someone who holds it is not below you, so you cannot change it.",
              }),
            ]
          : []),
        el("div", { className: "person-actions" }, buttons),
      ]);
    }),
  );
}

/**
 * Create a role (role is null) or change one.
 * @param {Role | null} role
 */
async function roleDialog(role) {
  const granted = role?.permissions ?? [];
  const saved = await openFormDialog({
    title: role ? `Change ${role.name}` : "New role",
    lead: "A role can grant only what you hold yourself. Changing what a role grants asks for your password first.",
    submitLabel: role ? "Save" : "Create",
    fields: [
      { name: "name", label: "Name", type: "text", value: role?.name ?? "", required: true },
      {
        name: "permissions",
        label: "What it allows",
        type: "checks",
        value: [...granted].sort().join(" "),
        options: permissionChoices(state.permissions, granted, can),
      },
    ],
    run: (values) => {
      const codes = values.permissions.split(" ").filter(Boolean);
      if (!role) return createRole(values.name, codes);
      /** @type {{ name?: string, permissions?: string[] }} only what changed */
      const changes = {};
      if (values.name !== role.name) changes.name = values.name;
      if (codes.join(" ") !== [...granted].sort().join(" ")) changes.permissions = codes;
      return Object.keys(changes).length ? updateRole(role.id, changes) : Promise.resolve(role);
    },
  });
  if (!saved) return;
  say(
    role ? `${saved.name} saved.` : `${saved.name} created. Give it to people on the People page.`,
  );
  await reloadRoles();
}

/** @param {Role} role */
async function archive(role) {
  const done = await confirmChange({
    title: `Archive ${role.name}?`,
    message: "Everyone who holds it loses what it allows, at once. It stays listed as archived.",
    confirmLabel: "Archive",
    run: () => archiveRole(role.id),
  });
  if (!done) return;
  say(`${role.name} archived.`);
  await reloadRoles();
}

/** The owners, and (for owners) adding and removing them. */
async function drawOwners() {
  const list = document.getElementById("owner-list");
  if (!list) return;
  /** @type {import("../api/roles.js").Owner[]} */
  let owners;
  try {
    owners = await listOwners();
  } catch (error) {
    reportProblem(error);
    return;
  }
  const mayChange = can("company.transfer_ownership");
  const me = currentSession()?.user.id;
  list.replaceChildren(
    ...owners.map((owner) => {
      const children = [
        el("span", { text: owner.id === me ? `${owner.display_name} (you)` : owner.display_name }),
      ];
      if (mayChange && owners.length > 1) {
        children.push(
          actionButton("Remove", () => removeOwnerDialog(owner), {
            className: "button button--small",
            ariaLabel: `Remove ${owner.display_name} as an owner`,
          }),
        );
      }
      return el("li", { className: "person-row" }, children);
    }),
  );
  const add = document.getElementById("add-owner");
  if (add) {
    add.hidden = !mayChange;
    add.onclick = () => addOwnerDialog(owners.map((o) => o.id));
  }
}

/**
 * @param {string[]} current the owners now
 */
async function addOwnerDialog(current) {
  const result = await openFormDialog({
    title: "Add an owner",
    lead: "Owners can do everything, including changing the owners. Every other owner must agree, and your password is asked first.",
    submitLabel: "Propose",
    fields: [
      {
        name: "user_id",
        label: "Person",
        type: "select",
        options: state.people
          .filter((p) => p.status === "active" && !current.includes(p.id))
          .sort((a, b) => a.display_name.localeCompare(b.display_name))
          .map((p) => ({ value: p.id, label: p.display_name })),
      },
    ],
    run: (values) => addOwner(values.user_id),
  });
  if (!result) return;
  say(ownerMessage(result, "Done: they are now an owner."));
  await drawOwners();
}

/** @param {import("../api/roles.js").Owner} owner */
async function removeOwnerDialog(owner) {
  /** @type {OwnerResult | null} */
  let result = null;
  const done = await confirmChange({
    title: `Remove ${owner.display_name} as an owner?`,
    message: "Every other owner must agree. Your password is asked first.",
    confirmLabel: "Remove owner",
    run: async () => {
      result = await removeOwner(owner.id);
    },
  });
  if (!done || !result) return;
  say(ownerMessage(result, `Done: ${owner.display_name} is no longer an owner.`));
  await drawOwners();
}

// Load the session first (signed-out visitors go to the sign-in page), then the page.
if (document.getElementById("role-list")) {
  startSignedInPage(() => showRoles());
}

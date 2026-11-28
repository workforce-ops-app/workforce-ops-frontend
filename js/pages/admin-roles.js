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
// change, and who must agree depends on the change (decision 0032): adding an owner needs
// every other owner; removing one needs every owner except the one asking and the one
// being removed (nobody can block their own removal). So with two owners, either removes
// the other at once. Each popup names who must agree, or says the change takes effect at
// once (ownerConsequence), and the answer is either "Done" or "Sent for approval to ...".
// Never the last owner (the API refuses, and says so).
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
import { el } from "../core/dom.js";
import { can, currentSession } from "../core/session.js";

/** @typedef {import("../api/roles.js").Role} Role */
/** @typedef {import("../api/roles.js").Permission} Permission */
/** @typedef {import("../api/roles.js").OwnerResult} OwnerResult */
/** @typedef {import("../api/roles.js").Owner} Owner */

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
 * Who must agree to an owner change, by the backend's rule (decision 0032;
 * app/modules/owners/service.py), from the owners as the page last loaded them:
 *   - adding someone: every owner except the one asking (who counts as agreeing);
 *   - removing someone: every owner except the one asking and the one being removed.
 * The server works it out again when the change is sent; this is only what the popup says.
 * @param {"add" | "remove"} change
 * @param {Owner[]} owners
 * @param {string | undefined} me the person asking
 * @param {string} [personId] the owner to remove
 * @returns {Owner[]}
 */
export function ownersWhoMustAgree(change, owners, me, personId) {
  return owners.filter((o) => o.id !== me && (change === "add" || o.id !== personId));
}

/**
 * What an owner change will do, for its popup (review of #93, point 3): either that it
 * takes effect at once, or who must agree first. The password is asked first either way.
 * @param {"add" | "remove"} change
 * @param {Owner[]} owners
 * @param {string | undefined} me the person asking
 * @param {Owner} [person] the owner to remove
 */
export function ownerConsequence(change, owners, me, person) {
  // Step 1: the names of everyone who must agree.
  const needed = ownersWhoMustAgree(change, owners, me, person?.id).map((o) => o.display_name);
  // Step 2: removing someone else: say they are not asked, so nobody expects them to have
  // a say.
  const notAsked =
    change === "remove" && person && person.id !== me
      ? ` ${person.display_name} is not asked.`
      : "";
  // Step 3: nobody to ask means it happens as soon as the password is accepted.
  if (needed.length === 0) {
    return `This takes effect at once, as soon as your password is checked.${notAsked}`;
  }
  const agree = needed.length === 1 ? "agrees" : "all agree";
  return `This takes effect only once ${joinNames(needed)} ${agree}.${notAsked} Your password is asked first.`;
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

/**
 * @type {{
 *   roles: Role[], permissions: Permission[], people: import("../api/users.js").Person[],
 *   owners: Owner[],
 * }}
 */
const state = { roles: [], permissions: [], people: [], owners: [] };

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
  await reloadOwners();
}

/**
 * Load the roles again after a change and draw them; the status line says `done`. If the
 * reload fails, the change was still saved: the line says both, and the old cards'
 * buttons are turned off (review of #93, point 4).
 * @param {string} done what was just saved
 */
async function reloadRoles(done) {
  try {
    state.roles = await listRoles();
  } catch (error) {
    markStale("role-list");
    reportProblem(error, done);
    return;
  }
  // Focus comes back to the button that opened the popup (point 7).
  keepFocus(drawRoles);
  say(done);
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
          actionButton("Change", () => roleDialog(role), {
            ariaLabel: `Change ${role.name}`,
            key: `role-change:${role.id}`,
          }),
          actionButton("Archive", () => archive(role), {
            className: "button button--danger-outline",
            ariaLabel: `Archive ${role.name}`,
            key: `role-archive:${role.id}`,
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
  await reloadRoles(
    role ? `${saved.name} saved.` : `${saved.name} created. Give it to people on the People page.`,
  );
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
  await reloadRoles(`${role.name} archived.`);
}

/**
 * Load the owners (again) and draw them. `done` is what was just saved, as for
 * reloadRoles; on the first load it is empty and the status line is left as it is.
 * @param {string} [done]
 */
async function reloadOwners(done = "") {
  try {
    state.owners = await listOwners();
  } catch (error) {
    // The old list and "Add an owner" act on owners that may have changed: turned off.
    markStale("owner-list");
    const add = document.getElementById("add-owner");
    if (add instanceof HTMLButtonElement) add.disabled = true;
    reportProblem(error, done);
    return;
  }
  keepFocus(drawOwners);
  if (done) say(done);
}

/** The owners, and (for owners) adding and removing them. */
function drawOwners() {
  const list = document.getElementById("owner-list");
  if (!list) return;
  const owners = state.owners;
  const mayChange = can("company.transfer_ownership");
  const me = currentSession()?.user.id;
  list.replaceChildren(
    ...owners.map((owner) => {
      const children = [
        el("span", {
          className: "person-row__text",
          text: owner.id === me ? `${owner.display_name} (you)` : owner.display_name,
        }),
      ];
      if (mayChange && owners.length > 1) {
        children.push(
          actionButton("Remove", () => removeOwnerDialog(owner), {
            className: "button button--small",
            ariaLabel: `Remove ${owner.display_name} as an owner`,
            key: `owner-remove:${owner.id}`,
          }),
        );
      }
      return el("li", { className: "person-row" }, children);
    }),
  );
  const add = document.getElementById("add-owner");
  if (add) {
    add.hidden = !mayChange;
    if (add instanceof HTMLButtonElement) add.disabled = false;
    add.onclick = () => addOwnerDialog(owners);
  }
}

/**
 * @param {Owner[]} owners the owners now
 */
async function addOwnerDialog(owners) {
  const current = owners.map((o) => o.id);
  const me = currentSession()?.user.id;
  const result = await openFormDialog({
    title: "Add an owner",
    // Who must agree, by name, or that it happens at once (point 3).
    lead: `Owners can do everything, including changing the owners. ${ownerConsequence("add", owners, me)}`,
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
  await reloadOwners(ownerMessage(result, "Done: they are now an owner."));
}

/** @param {Owner} owner */
async function removeOwnerDialog(owner) {
  /** @type {OwnerResult | null} */
  let result = null;
  const done = await confirmChange({
    title: `Remove ${owner.display_name} as an owner?`,
    // At once, or who must agree first, from the owners now (point 3).
    message: ownerConsequence("remove", state.owners, currentSession()?.user.id, owner),
    confirmLabel: "Remove owner",
    run: async () => {
      result = await removeOwner(owner.id);
    },
  });
  if (!done || !result) return;
  await reloadOwners(ownerMessage(result, `Done: ${owner.display_name} is no longer an owner.`));
}

// Load the session first (signed-out visitors go to the sign-in page), then the page.
if (document.getElementById("role-list")) {
  startSignedInPage(() => showRoles());
}

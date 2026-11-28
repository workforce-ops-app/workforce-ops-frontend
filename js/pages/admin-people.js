// People (pages/admin-people.html; docs/features/administration.md): the people of the
// company the user may see, a person's details, roles, and reporting lines, and the
// actions on them.
//
// What is offered follows two rules, both only for display (threats E1 to E4: the API
// checks every request regardless, so someone who un-hides a button still gets 403):
//   - the permission: user.manage for account actions, role.assign for roles,
//     reporting_line.manage for reporting lines;
//   - the place in the chain: actions only for people the user is above (you_are_above,
//     worked out by the API). Nobody is above themselves, so nobody acts on their own
//     account here; My account is for that.
//
// Sensitive actions (an admin-level role, any reporting line) need the password again:
// the API client shows the re-entry pop-up and repeats the request (reauth-dialog.js).
// A role at the user's own level is not given at once but sent for approval: the page
// then says to whom.
//
// Everything the server sends (names, emails, role names) is shown as text, never HTML.

import { ApiError, NetworkError } from "../api/client.js";
import { listDepartments } from "../api/shifts.js";
import {
  addLine,
  endLine,
  giveRole,
  listAssignments,
  listLines,
  listRoles,
  listTeams,
  removeAssignment,
} from "../api/roles.js";
import {
  accountAction,
  changePerson,
  createPerson,
  listPeople,
  makeLink,
  signPersonOut,
} from "../api/users.js";
import { joinNames, reportProblem } from "../components/admin-page.js";
import { startSignedInPage } from "../components/app-shell.js";
import { confirmChange } from "../components/confirm-dialog.js";
import { openFormDialog } from "../components/form-dialog.js";
import { showLinkOnce } from "../components/link-dialog.js";
import { el, setText } from "../core/dom.js";
import { can, currentSession } from "../core/session.js";

/** @typedef {import("../api/users.js").Person} Person */
/** @typedef {import("../api/roles.js").Assignment} Assignment */
/** @typedef {import("../api/roles.js").Role} Role */
/** @typedef {import("../api/roles.js").Line} Line */
/** @typedef {{ id: string, name: string }} Named */

// --- Small rules, exported for the tests --------------------------------------------------

/**
 * Whether a person matches the search box: their name or email contains every word typed,
 * ignoring case.
 * @param {Person} person
 * @param {string} query
 */
export function matches(person, query) {
  const text = `${person.display_name} ${person.email}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

/**
 * A person's account status in plain words.
 * @param {Person} person
 */
export function statusLabel(person) {
  const base = { invited: "No password yet", active: "Active", deactivated: "Deactivated" }[
    person.status
  ];
  return person.locked ? `${base}, locked` : base;
}

/**
 * Where an assignment applies, in plain words ("Kitchen", "Weekend Crew team").
 * @param {{ scope_type: string, scope_id: string | null }} assignment
 * @param {{ departments: Map<string, string>, teams: Map<string, string>, people: Map<string, string> }} names
 */
export function scopeLabel(assignment, names) {
  const id = assignment.scope_id ?? "";
  switch (assignment.scope_type) {
    case "company":
      return "the whole company";
    case "department":
      return `the ${names.departments.get(id) ?? "unknown"} department`;
    case "team":
      return `the ${names.teams.get(id) ?? "unknown"} team`;
    default:
      return `only ${names.people.get(id) ?? "one person"}`;
  }
}

/**
 * What the give-a-role form says after sending.
 * @param {import("../api/roles.js").GiveResult} result
 * @param {string} roleName
 * @param {string} personName
 */
export function giveMessage(result, roleName, personName) {
  if (result.given) return `${personName} now holds ${roleName}.`;
  const names = result.request.reviewers.map((reviewer) => reviewer.display_name);
  if (names.length === 0) {
    return "Sent for approval. Nobody can review it right now, so it will be declined after 7 days unless that changes.";
  }
  return `Sent for approval to ${joinNames(names)}. ${personName} gets ${roleName} once it is approved.`;
}

/** A list that could not be loaded for another reason than a refusal (see `loadOrRefused`). */
export const FAILED = Symbol("failed");

/**
 * Load a list that the user may or may not be allowed to see, and say which it was:
 *   - the list itself when it arrived;
 *   - null when the server refused it with 403: the user has no right to see it, which is
 *     expected, so the section is left out as if it did not exist;
 *   - FAILED for any other failure (no answer, a 500, a 404): the user may see it, but it
 *     did not arrive, and the page must say so instead of quietly leaving it out.
 * A bug in our own code (any other error) is thrown on, to the console.
 * @template T
 * @param {Promise<T>} request
 * @returns {Promise<T | null | typeof FAILED>}
 */
export async function loadOrRefused(request) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return null;
    if (error instanceof ApiError || error instanceof NetworkError) return FAILED;
    throw error;
  }
}

/**
 * A short note in place of a section that could not be loaded (class "error", as the
 * page's other problem messages; role="alert", so screen readers hear it at once).
 * @param {string} what e.g. "Their roles"
 * @param {string} [retry] how to try again
 */
function notLoaded(what, retry = "choose the person again or reload the page") {
  return el("p", {
    className: "error",
    attrs: { role: "alert" },
    text: `${what} could not be loaded. Check the connection, then ${retry}.`,
  });
}

// --- The page ----------------------------------------------------------------------------

/**
 * Everything the page has loaded.
 * @typedef {{
 *   people: Person[], departments: Named[], teams: (Named & { department_id: string, archived: boolean })[],
 *   roles: Role[], rolesFailed: boolean, selected: string | null, query: string,
 * }} State
 */

/** @type {State} */
const state = {
  people: [],
  departments: [],
  teams: [],
  roles: [],
  // True when the role catalogue could not be loaded (not refused: failed), so "Give a
  // role" says why it is missing.
  rolesFailed: false,
  selected: null,
  query: "",
};

// Which drawing of the details is the current one. Every drawDetails() call takes the next
// number and, after each wait for the server, checks it still holds the latest one. If
// another person was chosen meanwhile, its answers are thrown away: otherwise a slow
// answer for Ana, arriving after Sofia was chosen, would show Ana's details and buttons
// under Sofia's highlighted name, and the next click would change the wrong account.
let detailsDrawing = 0;

// The account actions still running, as "person ID:action" (for example "ana:link").
// Kept here, not on the button, because choosing another person and coming back draws
// new buttons: a mark on the old button would be lost, and a second "Setup link" press
// would send a second request whose link cancels the first one shown.
/** @type {Set<string>} */
const running = new Set();

/** Names by ID, for showing places and people. */
function names() {
  return {
    departments: new Map(state.departments.map((d) => [d.id, d.name])),
    teams: new Map(state.teams.map((t) => [t.id, t.name])),
    people: new Map(state.people.map((p) => [p.id, p.display_name])),
  };
}

/** The company's time zone, for dates. */
function zone() {
  return currentSession()?.company.timezone ?? "UTC";
}

/** Load the people and the places, then draw the page. */
export async function showPeople() {
  const status = document.getElementById("status");
  try {
    // Roles are needed only to give them. Without role.view the server refuses the list
    // (403) and "Give a role" is simply not offered; any other failure is remembered, so
    // the roles section can say that the list could not be loaded.
    const [people, departments, teams, roles] = await Promise.all([
      listPeople(),
      listDepartments(),
      listTeams(),
      can("role.assign") ? loadOrRefused(listRoles()) : Promise.resolve([]),
    ]);
    Object.assign(state, {
      people,
      departments,
      teams,
      roles: Array.isArray(roles) ? roles : [],
      rolesFailed: roles === FAILED,
    });
  } catch (error) {
    reportProblem(error);
    return;
  }
  if (status) setText(status, "");
  const add = document.getElementById("add-person");
  add?.addEventListener("click", () => addPersonDialog());
  const search = document.getElementById("people-search");
  search?.addEventListener("input", () => {
    state.query = /** @type {HTMLInputElement} */ (search).value;
    drawList();
  });
  drawList();
}

/** Load the people again after a change, keeping the selection. */
async function reload() {
  try {
    state.people = await listPeople();
  } catch (error) {
    reportProblem(error);
    return;
  }
  drawList();
  if (state.selected) await drawDetails(state.selected);
}

/** The list on the left: everyone matching the search, by name. */
function drawList() {
  const list = document.getElementById("people-list");
  if (!list) return;
  const shown = state.people
    .filter((person) => matches(person, state.query))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  list.replaceChildren(
    ...shown.map((person) => {
      const button = el(
        "button",
        {
          className: "people-list__person",
          attrs: {
            type: "button",
            "aria-pressed": String(person.id === state.selected),
            // Which person the button is for, so focus can be put back on it after the
            // list is drawn again (selectedButton).
            "data-person-id": person.id,
          },
        },
        [
          el("span", { className: "people-list__name", text: person.display_name }),
          el("span", { className: "people-list__status muted", text: statusLabel(person) }),
        ],
      );
      button.addEventListener("click", () => choose(person.id));
      return el("li", {}, [button]);
    }),
  );
  if (shown.length === 0)
    list.replaceChildren(el("li", { className: "muted", text: "Nobody matches." }));
}

/**
 * The list button of the chosen person, if they are in the list as drawn now.
 * @returns {HTMLElement | null}
 */
function selectedButton() {
  if (!state.selected) return null;
  const list = document.getElementById("people-list");
  const buttons = list ? list.querySelectorAll("[data-person-id]") : [];
  for (const button of buttons) {
    if (button instanceof HTMLElement && button.dataset.personId === state.selected) {
      return button;
    }
  }
  return null;
}

/**
 * Someone was chosen in the list (by mouse, finger, or keyboard).
 * @param {string} personId
 */
function choose(personId) {
  state.selected = personId;
  // 1. Draw the list again, so the highlight moves to them. That replaces every button,
  //    the one just pressed included, and focus would fall back to the page's start; a
  //    keyboard user would have to Tab all the way back. So focus goes to the new button
  //    for the same person. preventScroll: the list does not jump.
  drawList();
  selectedButton()?.focus({ preventScroll: true });
  // 2. Then their details. On a phone the details sit under the whole list, maybe several
  //    screens down; bring them into view (the "Back to the list" button returns).
  drawDetails(personId);
  if (isNarrow()) {
    document.getElementById("person-details")?.scrollIntoView?.({ block: "start" });
  }
}

/** Whether the list and the details are stacked (the phone layout in admin-people.css). */
function isNarrow() {
  return window.matchMedia?.("(width < 56rem)").matches ?? false;
}

/**
 * The details on the right: the person, their roles, and their reporting lines.
 * @param {string} personId
 */
async function drawDetails(personId) {
  const panel = document.getElementById("person-details");
  const person = state.people.find((p) => p.id === personId);
  // Only the chosen person's details are ever drawn.
  if (!panel || !person || state.selected !== personId) return;
  panel.hidden = false;
  // This drawing's number: any older drawing still waiting for the server gives up.
  const drawing = ++detailsDrawing;
  const known = names();
  const mayAct = person.you_are_above;

  // 1. At once, before asking the server anything: this person's name and facts, and a
  //    loading line. The previous person's buttons are gone from the page now, so they
  //    cannot be pressed for the wrong account while this person's answers are on the way.
  const top = [backToList(), ...facts(person, known)];
  panel.replaceChildren(
    ...top,
    el("p", { className: "muted", attrs: { role: "status" }, text: "Loading roles and lines…" }),
  );

  // 2. Roles and lines come from their own requests. A 403 (no right to see them) leaves
  //    the section out; any other failure says so in its place (loadOrRefused).
  const [assignments, lines] = await Promise.all([
    loadOrRefused(listAssignments(person.id)),
    loadOrRefused(listLines(person.id)),
  ]);

  // 3. Someone else was chosen while we waited (or the page drew this person again with
  //    fresher data): these answers are out of date, so they are thrown away.
  if (drawing !== detailsDrawing || state.selected !== personId) return;

  const parts = [...top];
  if (!mayAct) {
    parts.push(
      el("p", {
        className: "muted",
        text:
          person.id === currentSession()?.user.id
            ? "This is you. Change your own password on My account."
            : "You are not above this person in the reporting chain, so you cannot change their account or roles.",
      }),
    );
  } else if (can("user.manage")) {
    parts.push(accountButtons(person));
  }

  if (assignments === FAILED) parts.push(failedSection("Roles", "Their roles"));
  else if (assignments) parts.push(rolesSection(person, assignments, mayAct));
  if (lines === FAILED) parts.push(failedSection("Reporting lines", "Their reporting lines"));
  else if (lines) parts.push(linesSection(person, lines, mayAct));
  panel.replaceChildren(...parts);
}

/**
 * "Back to the list", shown on phones only (admin-people.css), where the details are
 * under the whole list: it returns to the chosen person's button in the list.
 */
function backToList() {
  const back = el("button", {
    className: "button button--small person-back",
    text: "Back to the list",
    attrs: { type: "button" },
  });
  // Focusing the button also scrolls the list to it.
  back.addEventListener("click", () => selectedButton()?.focus());
  return back;
}

/**
 * A section heading with a note that its content could not be loaded.
 * @param {string} title "Roles"
 * @param {string} what "Their roles"
 */
function failedSection(title, what) {
  return el("section", { className: "person-section" }, [
    el("h3", { text: title }),
    notLoaded(what),
  ]);
}

/**
 * The person's name and facts, the top of the details.
 * @param {Person} person
 * @param {ReturnType<typeof names>} known
 * @returns {HTMLElement[]}
 */
function facts(person, known) {
  const teams = person.team_ids
    .map((id) => known.teams.get(id))
    .filter(Boolean)
    .join(", ");
  return [
    el("h2", { text: person.display_name, attrs: { id: "person-name" } }),
    el("dl", { className: "person-facts" }, [
      el("dt", { text: "Email" }),
      el("dd", { text: person.email }),
      el("dt", { text: "Home department" }),
      el("dd", { text: known.departments.get(person.department_id) ?? "Unknown" }),
      el("dt", { text: "Teams" }),
      el("dd", { text: teams || "None" }),
      el("dt", { text: "Account" }),
      el("dd", { text: statusLabel(person) }),
    ]),
  ];
}

/**
 * The account actions for one person.
 * @param {Person} person
 */
function accountButtons(person) {
  /** @type {HTMLElement[]} */
  const buttons = [];
  /**
   * @param {string} label
   * @param {() => Promise<unknown>} action
   * @param {string} [className]
   * @param {string} [kind] what the action is, for telling whether it is still running;
   *   the label unless two labels are the same action
   */
  const button = (label, action, className = "button", kind = label) => {
    const key = `${person.id}:${kind}`;
    const element = el("button", {
      className,
      text: label,
      attrs: { type: "button", "data-action": key },
    });
    // Drawn while the action is still running (the person was chosen again): off at once.
    if (running.has(key)) element.setAttribute("aria-disabled", "true");
    element.addEventListener("click", async () => {
      // One request at a time per person and action. A double click on "Setup link" would
      // otherwise send two requests: both succeed, but the second link cancels the first,
      // so the first one shown would already be dead. Until the action (its popup
      // included) has finished, further clicks are ignored, also on buttons drawn again
      // meanwhile, and the buttons say they are off with aria-disabled. Not the disabled
      // attribute: a disabled button loses keyboard focus, and the popup could then not
      // give focus back to it when it closes.
      if (running.has(key)) return;
      running.add(key);
      element.setAttribute("aria-disabled", "true");
      try {
        await action();
      } catch (error) {
        reportProblem(error);
      } finally {
        running.delete(key);
        // This button, and the one drawn in its place if the person was chosen again.
        element.removeAttribute("aria-disabled");
        for (const drawn of document.querySelectorAll("[data-action]")) {
          if (drawn.getAttribute("data-action") === key) drawn.removeAttribute("aria-disabled");
        }
      }
    });
    buttons.push(element);
  };

  button("Change details", () => editPersonDialog(person));
  if (person.status !== "deactivated") {
    const purpose = person.status === "invited" ? "setup" : "reset";
    // Setup and reset are one action ("link"): any new link cancels the last one.
    button(
      purpose === "setup" ? "Setup link" : "Reset link",
      async () => {
        const link = await makeLink(person.id, purpose);
        await showLinkOnce(link, { name: person.display_name, zone: zone() });
      },
      "button",
      "link",
    );
  }
  if (person.locked) {
    button("Unlock", async () => {
      await accountAction(person.id, "unlock");
      await reload();
    });
  }
  if (person.status === "active") {
    button("Sign out everywhere", () =>
      confirmChange({
        title: `Sign ${person.display_name} out everywhere?`,
        message: "Every browser where they are signed in is signed out.",
        confirmLabel: "Sign out",
        run: () => signPersonOut(person.id),
      }),
    );
  }
  if (person.status === "deactivated") {
    button("Reactivate", async () => {
      await accountAction(person.id, "reactivate");
      await reload();
    });
  } else {
    button(
      "Deactivate",
      async () => {
        /** @type {string[]} */
        let upcoming = [];
        const done = await confirmChange({
          title: `Deactivate ${person.display_name}?`,
          message:
            "They are signed out and cannot sign in. Their history is kept, and you can reactivate them later.",
          confirmLabel: "Deactivate",
          run: async () => {
            upcoming = (await accountAction(person.id, "deactivate")).upcoming_shift_ids ?? [];
          },
        });
        if (!done) return;
        await reload();
        const status = document.getElementById("status");
        if (status && upcoming.length > 0) {
          setText(
            status,
            `${person.display_name} still has ${upcoming.length} upcoming shift(s). Give them to someone else on the Department page.`,
          );
        }
      },
      "button button--danger-outline",
    );
  }
  return el("div", { className: "person-actions" }, buttons);
}

/**
 * The roles a person holds, with remove buttons and "Give a role".
 * @param {Person} person
 * @param {Assignment[]} assignments
 * @param {boolean} mayAct
 */
function rolesSection(person, assignments, mayAct) {
  const known = names();
  const manage = mayAct && can("role.assign");
  const rows = assignments.map((assignment) => {
    const text = `${assignment.role_name}, for ${scopeLabel(assignment, known)}${assignment.role_archived ? " (archived: grants nothing)" : ""}`;
    const children = [el("span", { text })];
    // The Owner role is changed only through the owners' agreement (Roles page).
    if (manage && assignment.built_in !== "owner") {
      const remove = el("button", {
        className: "button button--small",
        text: "Remove",
        attrs: { type: "button", "aria-label": `Remove ${assignment.role_name}` },
      });
      remove.addEventListener("click", async () => {
        const done = await confirmChange({
          title: `Remove ${assignment.role_name}?`,
          message: `${person.display_name} loses what this role allows, at once.`,
          confirmLabel: "Remove",
          run: () => removeAssignment(assignment.id),
        });
        if (done) await drawDetails(person.id);
      });
      children.push(remove);
    }
    return el("li", { className: "person-row" }, children);
  });
  const section = el(
    "section",
    { className: "person-section", attrs: { "aria-labelledby": "roles-title" } },
    [
      el("h3", { text: "Roles", attrs: { id: "roles-title" } }),
      rows.length
        ? el("ul", { className: "person-rows" }, rows)
        : el("p", { className: "muted", text: "No roles." }),
    ],
  );
  if (manage && state.roles.length > 0) {
    const give = el("button", {
      className: "button button--primary",
      text: "Give a role",
      attrs: { type: "button" },
    });
    give.addEventListener("click", () => giveRoleDialog(person));
    section.append(give);
  } else if (manage && state.rolesFailed) {
    // The catalogue of roles did not arrive (not refused): say why "Give a role" is missing.
    section.append(notLoaded("The list of roles to give", "reload the page"));
  }
  return section;
}

/**
 * A person's managers and reports, with end buttons and add forms.
 * @param {Person} person
 * @param {Line[]} lines
 * @param {boolean} mayAct
 */
function linesSection(person, lines, mayAct) {
  const known = names();
  const manage = mayAct && can("reporting_line.manage");
  /**
   * @param {Line} line
   * @param {string} otherId
   */
  const row = (line, otherId) => {
    const children = [el("span", { text: known.people.get(otherId) ?? "Someone you cannot see" })];
    if (manage) {
      const end = el("button", {
        className: "button button--small",
        text: "End",
        attrs: { type: "button" },
      });
      end.addEventListener("click", async () => {
        const done = await confirmChange({
          title: "End this reporting line?",
          message: `${known.people.get(line.employee_id) ?? "They"} will no longer report to ${known.people.get(line.manager_id) ?? "this manager"}. It is kept as history.`,
          confirmLabel: "End line",
          run: () => endLine(line.id),
        });
        if (done) await reload();
      });
      children.push(end);
    }
    return el("li", { className: "person-row" }, children);
  };
  const current = lines.filter((line) => line.ended_at === null);
  const managers = current.filter((line) => line.employee_id === person.id);
  const reports = current.filter((line) => line.manager_id === person.id);
  /** @param {HTMLElement[]} items */
  const listOf = (items) =>
    items.length
      ? el("ul", { className: "person-rows" }, items)
      : el("p", { className: "muted", text: "None." });

  const section = el(
    "section",
    { className: "person-section", attrs: { "aria-labelledby": "lines-title" } },
    [
      el("h3", { text: "Reporting lines", attrs: { id: "lines-title" } }),
      el("h4", { text: "Reports to" }),
      listOf(managers.map((line) => row(line, line.manager_id))),
      el("h4", { text: "Their reports" }),
      listOf(reports.map((line) => row(line, line.employee_id))),
    ],
  );
  if (manage) {
    const add = el("button", {
      className: "button",
      text: "Add a manager",
      attrs: { type: "button" },
    });
    add.addEventListener("click", () =>
      addManagerDialog(
        person,
        managers.map((line) => line.manager_id),
      ),
    );
    section.append(add);
  }
  return section;
}

// --- Dialogs -----------------------------------------------------------------------------

/** People and places as choices for a select. */
const choices = {
  departments: () => state.departments.map((d) => ({ value: d.id, label: d.name })),
  /** @param {string[]} [except] */
  people: (except = []) =>
    state.people
      .filter((p) => p.status !== "deactivated" && !except.includes(p.id))
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .map((p) => ({ value: p.id, label: p.display_name })),
};

async function addPersonDialog() {
  const me = currentSession()?.user.id ?? "";
  const made = await openFormDialog({
    title: "Add a person",
    lead: "They get no password yet: you will get a setup link to give them.",
    submitLabel: "Add",
    fields: [
      { name: "display_name", label: "Name", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      {
        name: "department_id",
        label: "Home department",
        type: "select",
        options: choices.departments(),
      },
      {
        name: "manager_id",
        label: "Reports to",
        type: "select",
        value: me,
        hint: "Who they report to decides who may manage their account.",
        options: choices.people(),
      },
    ],
    run: (values) =>
      createPerson({
        display_name: values.display_name,
        email: values.email,
        department_id: values.department_id,
        manager_id: values.manager_id,
      }),
  });
  if (!made) return;
  state.selected = made.id;
  await reload();
  try {
    const link = await makeLink(made.id, "setup");
    await showLinkOnce(link, { name: made.display_name, zone: zone() });
  } catch (error) {
    reportProblem(error);
  }
}

/** @param {Person} person */
async function editPersonDialog(person) {
  const changed = await openFormDialog({
    title: `Change ${person.display_name}`,
    submitLabel: "Save",
    fields: [
      {
        name: "display_name",
        label: "Name",
        type: "text",
        value: person.display_name,
        required: true,
      },
      { name: "email", label: "Email", type: "email", value: person.email, required: true },
      {
        name: "department_id",
        label: "Home department",
        type: "select",
        value: person.department_id,
        options: choices.departments(),
      },
    ],
    run: (values) => {
      /** @type {Record<string, string>} only what changed */
      const changes = {};
      for (const key of /** @type {const} */ (["display_name", "email", "department_id"])) {
        if (values[key] !== person[key]) changes[key] = values[key];
      }
      return Object.keys(changes).length
        ? changePerson(person.id, changes)
        : Promise.resolve(person);
    },
  });
  if (changed) await reload();
}

/** @param {Person} person */
async function giveRoleDialog(person) {
  const roles = state.roles.filter((role) => !role.archived && role.built_in !== "owner");
  const scopes = [
    { value: "company", label: "The whole company" },
    { value: "department", label: "One department" },
    { value: "team", label: "One team" },
    { value: "employee", label: "Only one person" },
  ];
  let chosenRole = "";
  /** @type {import("../api/roles.js").GiveResult | null} */
  const result = await openFormDialog({
    title: `Give ${person.display_name} a role`,
    lead: "A role at your own level is sent for approval to someone above you. Admin-level roles ask for your password first.",
    submitLabel: "Give role",
    fields: [
      {
        name: "role_id",
        label: "Role",
        type: "select",
        options: roles.map((r) => ({ value: r.id, label: r.name })),
      },
      { name: "scope_type", label: "Where it applies", type: "select", options: scopes },
      {
        name: "scope_id",
        label: "Which one",
        type: "select",
        shown: (values) => values.scope_type !== "company",
        options: (values) => {
          if (values.scope_type === "department") return choices.departments();
          if (values.scope_type === "team") {
            return state.teams
              .filter((t) => !t.archived)
              .map((t) => ({ value: t.id, label: t.name }));
          }
          return choices.people();
        },
      },
    ],
    run: (values) => {
      chosenRole = values.role_id;
      return giveRole({
        user_id: person.id,
        role_id: values.role_id,
        scope_type: values.scope_type,
        scope_id: values.scope_type === "company" ? null : values.scope_id,
      });
    },
  });
  if (!result) return;
  const status = document.getElementById("status");
  const roleName = roles.find((r) => r.id === chosenRole)?.name ?? "the role";
  if (status) setText(status, giveMessage(result, roleName, person.display_name));
  await drawDetails(person.id);
}

/**
 * @param {Person} person
 * @param {string[]} current their managers now
 */
async function addManagerDialog(person, current) {
  const added = await openFormDialog({
    title: `Who else does ${person.display_name} report to?`,
    lead: "Reporting lines decide who may manage whom, so this asks for your password first.",
    submitLabel: "Add line",
    fields: [
      {
        name: "manager_id",
        label: "Manager",
        type: "select",
        options: choices.people([person.id, ...current]),
      },
    ],
    run: (values) => addLine(values.manager_id, person.id),
  });
  if (added) await reload();
}

// Load the session first (signed-out visitors go to the sign-in page), then the page.
if (document.getElementById("people-list")) {
  startSignedInPage(() => showPeople());
}

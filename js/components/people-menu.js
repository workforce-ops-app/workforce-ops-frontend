// The people menu on the left of the department calendar (#83, slice CAL3; frontend docs,
// features/schedules.md). It lists the people with a shift in the week, each with their
// colour and their scheduled hours, in sections by their roles, and lets a manager narrow
// the calendar down:
// - each name is a toggle button that shows or hides that person's shifts;
// - each section has one button to show or hide everyone in it;
// - a search box keeps only the people whose names hold every word typed;
// - "Clear filters" shows everyone again.
// A shift shows only if its person matches the search AND is switched on.
//
// The menu only decides who is shown; the page passes that on to the calendar
// (showPeople in js/components/week-calendar.js) and to the tiles at the top.
//
// Security: names and role names are written by users, so everything goes through el(),
// which sets text only. The search runs in the browser over shifts the page already has;
// it sends nothing to the server.

import { el } from "../core/dom.js";
import { formatHours, hoursBetween, roundHours } from "../core/time.js";
import { personColourClass } from "./person-colour.js";

/** @typedef {import("../api/shifts.js").Shift} Shift */
/** @typedef {import("../api/shifts.js").RoleRef} RoleRef */

/**
 * One person in the menu.
 * @typedef {{ id: string, name: string, roles: RoleRef[], hours: number }} MenuPerson
 */

/**
 * What the menu has chosen: the people switched off (by employee ID), and the search. Kept
 * by the page while it is open, so the choices stay when another week loads; not saved
 * between visits.
 * @typedef {{ hidden: Set<string>, query: string }} Filters
 */

/** @returns {Filters} nothing filtered: everyone shown */
export function noFilters() {
  return { hidden: new Set(), query: "" };
}

/**
 * The starting roles in the menu's order, with their section titles. A role the company
 * added sits between Manager and Employee, under its own name.
 */
const STARTING = /** @type {const} */ ([
  ["owner", "Owners"],
  ["administrator", "Administrators"],
  ["manager", "Managers"],
]);
const EMPLOYEE_RANK = STARTING.length + 1;
const OTHER_RANK = STARTING.length + 2;

/**
 * Which section a person belongs in: the first of their roles in the menu's order (Owner,
 * Administrator, Manager, the company's own roles by name, Employee), or "Other" without
 * any. Each person is in exactly one section.
 * @param {RoleRef[]} roles
 * @returns {{ rank: number, title: string }} rank orders the sections; title is shown
 */
export function sectionOf(roles) {
  /** @type {{ rank: number, title: string }} */
  let best = { rank: OTHER_RANK, title: "Other" };
  for (const role of roles) {
    let found;
    const starting = STARTING.findIndex(([code]) => code === role.built_in);
    if (starting !== -1) found = { rank: starting, title: STARTING[starting][1] };
    else if (role.built_in === "employee") found = { rank: EMPLOYEE_RANK, title: "Employees" };
    else found = { rank: STARTING.length, title: role.name };
    // Lower rank wins; between two of the company's own roles, the first by name.
    if (
      found.rank < best.rank ||
      (found.rank === best.rank && found.title.localeCompare(best.title) < 0)
    ) {
      best = found;
    }
  }
  return best;
}

/**
 * The people with a shift in the week, each once, by name, with their total scheduled
 * hours: each shift's real length (hoursBetween measures between the UTC moments, so an
 * overnight shift counts all of it). Open shifts belong to nobody and are left out.
 * @param {Shift[]} shifts the week's shifts
 * @returns {MenuPerson[]}
 */
export function peopleOf(shifts) {
  /** @type {Map<string, MenuPerson>} */
  const people = new Map();
  for (const shift of shifts) {
    const employee = shift.employee;
    if (!employee) continue;
    const person = people.get(employee.id) ?? {
      id: employee.id,
      name: employee.display_name,
      roles: employee.roles ?? [],
      hours: 0,
    };
    person.hours += hoursBetween(shift.starts_at, shift.ends_at);
    people.set(employee.id, person);
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The menu's sections in order, each with its people (already by name). Empty sections
 * are not listed.
 * @param {MenuPerson[]} people
 * @returns {{ title: string, people: MenuPerson[] }[]}
 */
export function sectionsOf(people) {
  /** @type {Map<string, { rank: number, title: string, people: MenuPerson[] }>} */
  const sections = new Map();
  for (const person of people) {
    const { rank, title } = sectionOf(person.roles);
    // Keyed by rank and title, so a company role called "Managers" stays its own section.
    const key = `${rank}:${title}`;
    const section = sections.get(key) ?? { rank, title, people: [] };
    section.people.push(person);
    sections.set(key, section);
  }
  return [...sections.values()]
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
    .map(({ title, people: members }) => ({ title, people: members }));
}

/**
 * Whether a name matches the search: every word typed appears in the name, in any order,
 * ignoring capitals. "ana di" matches "Ana Diaz" but not "Ana Park". An empty search
 * matches everyone.
 * @param {string} name
 * @param {string} query
 * @returns {boolean}
 */
export function nameMatches(name, query) {
  const lower = name.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => lower.includes(word));
}

/**
 * Whether a person's shifts are shown: they match the search AND are switched on.
 * @param {Filters} filters
 * @param {{ id: string, name: string }} person
 * @returns {boolean}
 */
export function isShown(filters, person) {
  return !filters.hidden.has(person.id) && nameMatches(person.name, filters.query);
}

/**
 * Whether anything is filtered at all (a search typed, or somebody switched off).
 * @param {Filters} filters
 * @returns {boolean}
 */
export function isFiltering(filters) {
  return filters.hidden.size > 0 || filters.query.trim() !== "";
}

/**
 * "32 h" next to a name (screen readers hear "32 hours" instead).
 * @param {number} hours
 * @returns {HTMLElement[]}
 */
function hoursLabel(hours) {
  return [
    el("span", {
      className: "people-menu__hours",
      text: `${roundHours(hours)} h`,
      attrs: { "aria-hidden": "true" },
    }),
    el("span", { className: "visually-hidden", text: `, ${formatHours(hours)}` }),
  ];
}

/**
 * The menu for one week. It changes filters in place and calls onChange after every
 * change, so the page can show the calendar and the tiles again. The menu is built once
 * per week and then only updated, so the search box keeps its focus while typing.
 * @param {MenuPerson[]} people what peopleOf returned
 * @param {Filters} filters the page's filters (changed in place)
 * @param {() => void} onChange
 * @returns {HTMLElement}
 */
export function peopleMenu(people, filters, onChange) {
  // The search, with a visible label.
  const search = /** @type {HTMLInputElement} */ (
    el("input", {
      className: "field__input people-menu__search",
      attrs: { id: "people-search", type: "search", autocomplete: "off", spellcheck: "false" },
    })
  );
  search.value = filters.query;

  // How many are shown, said politely by screen readers after each change.
  const count = el("p", {
    className: "people-menu__count",
    attrs: { role: "status", "aria-live": "polite" },
  });

  const clear = /** @type {HTMLButtonElement} */ (
    el("button", {
      className: "button button--secondary people-menu__clear",
      text: "Clear filters",
      attrs: { type: "button" },
    })
  );

  /** @type {{ person: MenuPerson, item: HTMLElement, toggle: HTMLElement }[]} */
  const rows = [];
  /** @type {{ members: MenuPerson[], part: HTMLElement, all: HTMLElement, title: string }[]} */
  const parts = [];

  const sections = sectionsOf(people).map(({ title, people: members }, index) => {
    const headingId = `people-menu-section-${index}`;
    const all = el("button", {
      className: "people-menu__all",
      attrs: { type: "button" },
    });
    const items = members.map((person) => {
      const toggle = el(
        "button",
        {
          className: `people-menu__person ${personColourClass(person.id)}`,
          attrs: { type: "button" },
        },
        [
          el("span", { className: "people-menu__swatch", attrs: { "aria-hidden": "true" } }),
          el("span", { className: "people-menu__name", text: person.name }),
          ...hoursLabel(person.hours),
        ],
      );
      toggle.addEventListener("click", () => {
        if (filters.hidden.has(person.id)) filters.hidden.delete(person.id);
        else filters.hidden.add(person.id);
        changed();
      });
      const item = el("li", {}, [toggle]);
      rows.push({ person, item, toggle });
      return item;
    });
    // One button for the whole section: hide everyone if all are on, else show everyone.
    all.addEventListener("click", () => {
      const allOn = members.every((person) => !filters.hidden.has(person.id));
      for (const person of members) {
        if (allOn) filters.hidden.add(person.id);
        else filters.hidden.delete(person.id);
      }
      changed();
    });
    const part = el(
      "section",
      { className: "people-menu__section", attrs: { "aria-labelledby": headingId } },
      [
        el("div", { className: "people-menu__section-head" }, [
          el("h3", { className: "people-menu__title", text: title, attrs: { id: headingId } }),
          all,
        ]),
        el("ul", { className: "people-menu__list" }, items),
      ],
    );
    parts.push({ members, part, all, title });
    return part;
  });

  /** Bring every button, the counts, and the visible names up to date. */
  function refresh() {
    for (const { person, item, toggle } of rows) {
      const on = !filters.hidden.has(person.id);
      toggle.setAttribute("aria-pressed", String(on));
      // The search narrows the list as well as the calendar.
      item.hidden = !nameMatches(person.name, filters.query);
    }
    for (const { members, part, all, title } of parts) {
      const allOn = members.every((person) => !filters.hidden.has(person.id));
      all.textContent = allOn ? "Hide all" : "Show all";
      // The visible word is short; screen readers hear which section it is for.
      all.setAttribute("aria-label", `${allOn ? "Hide" : "Show"} all ${title}`);
      // A section with nobody matching the search is left out.
      part.hidden = !members.some((person) => nameMatches(person.name, filters.query));
    }
    const shown = people.filter((person) => isShown(filters, person)).length;
    count.textContent = people.length
      ? `${shown} of ${people.length} ${people.length === 1 ? "person" : "people"} shown`
      : "Nobody is scheduled this week.";
    clear.disabled = !isFiltering(filters);
  }

  function changed() {
    refresh();
    onChange();
  }

  search.addEventListener("input", () => {
    filters.query = search.value;
    changed();
  });
  clear.addEventListener("click", () => {
    filters.hidden.clear();
    filters.query = "";
    search.value = "";
    changed();
    search.focus();
  });

  const menu = el(
    "section",
    { className: "people-menu", attrs: { "aria-labelledby": "people-menu-heading" } },
    [
      el("h2", {
        className: "people-menu__heading",
        text: "People",
        attrs: { id: "people-menu-heading" },
      }),
      el("label", {
        className: "field__label",
        text: "Search names",
        attrs: { for: "people-search" },
      }),
      search,
      count,
      clear,
      ...sections,
    ],
  );
  refresh();
  return menu;
}

// The people menu beside the department calendar (#83, slice CAL3): sections by role, the
// hours, the toggles, the search, and how the calendar hides people's blocks.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isFiltering,
  isShown,
  nameMatches,
  noFilters,
  peopleMenu,
  peopleOf,
  sectionOf,
  sectionsOf,
} from "../../js/components/people-menu.js";
import { showPeople, weekCalendar } from "../../js/components/week-calendar.js";
import { addDays } from "../../js/core/time.js";

/** @typedef {import("../../js/api/shifts.js").Shift} Shift */
/** @typedef {import("../../js/api/shifts.js").RoleRef} RoleRef */

const OWNER = /** @type {RoleRef} */ ({ name: "Owner", built_in: "owner" });
const ADMIN = /** @type {RoleRef} */ ({ name: "Administrator", built_in: "administrator" });
const MANAGER = /** @type {RoleRef} */ ({ name: "Manager", built_in: "manager" });
const EMPLOYEE = /** @type {RoleRef} */ ({ name: "Employee", built_in: "employee" });
/**
 * A role the company added.
 * @param {string} name
 * @returns {RoleRef}
 */
function custom(name) {
  return { name, built_in: null };
}

const MONDAY = "2026-10-05";
const KEYS = Array.from({ length: 7 }, (_, offset) => addDays(MONDAY, offset));

/**
 * A shift of one person, 9:00 to 17:00 in Chicago on a day of the test week.
 * @param {string} id
 * @param {{ id: string, name: string, roles?: RoleRef[] } | null} person null: open
 * @param {Partial<Shift>} [overrides]
 * @returns {Shift}
 */
function shift(id, person, overrides = {}) {
  return {
    id,
    department: { id: "d1", name: "Kitchen" },
    employee: person && {
      id: person.id,
      display_name: person.name,
      roles: person.roles ?? [EMPLOYEE],
    },
    starts_at: "2026-10-05T14:00:00Z",
    ends_at: "2026-10-05T22:00:00Z",
    timezone: "America/Chicago",
    status: person ? "scheduled" : "open",
    details: null,
    notes: null,
    event_name: null,
    event_description: null,
    ...overrides,
  };
}

const ANA = { id: "u1", name: "Ana Diaz", roles: [MANAGER, EMPLOYEE] };
const ANA_PARK = { id: "u2", name: "Ana Park", roles: [EMPLOYEE] };
const BEN = { id: "u3", name: "Ben Okafor", roles: [EMPLOYEE] };

afterEach(() => document.body.replaceChildren());

describe("sections", () => {
  it("puts each person under the first of their roles in the menu's order", () => {
    expect(sectionOf([EMPLOYEE, MANAGER]).title).toBe("Managers");
    expect(sectionOf([EMPLOYEE, OWNER, ADMIN]).title).toBe("Owners");
    expect(sectionOf([EMPLOYEE, custom("Shift lead")]).title).toBe("Shift lead");
    expect(sectionOf([custom("Trainer"), MANAGER]).title).toBe("Managers");
    // Two of the company's own roles: the first by name.
    expect(sectionOf([custom("Trainer"), custom("Shift lead")]).title).toBe("Shift lead");
    expect(sectionOf([EMPLOYEE]).title).toBe("Employees");
    expect(sectionOf([]).title).toBe("Other");
  });

  it("orders the sections Owner, Administrator, Manager, company roles by name, Employee, Other, and leaves empty ones out", () => {
    const people = peopleOf([
      shift("1", { id: "a", name: "Eve", roles: [EMPLOYEE] }),
      shift("2", { id: "b", name: "Zed", roles: [custom("Trainer")] }),
      shift("3", { id: "c", name: "Olivia", roles: [OWNER] }),
      shift("4", { id: "d", name: "Nobody", roles: [] }),
      shift("5", { id: "e", name: "Mia", roles: [MANAGER] }),
      shift("6", { id: "f", name: "Sam", roles: [custom("Shift lead")] }),
      shift("7", { id: "g", name: "Al", roles: [EMPLOYEE] }),
    ]);
    expect(sectionsOf(people).map((s) => [s.title, s.people.map((p) => p.name)])).toEqual([
      ["Owners", ["Olivia"]],
      ["Managers", ["Mia"]],
      ["Shift lead", ["Sam"]],
      ["Trainer", ["Zed"]],
      ["Employees", ["Al", "Eve"]],
      ["Other", ["Nobody"]],
    ]);
  });

  it("keeps a company role named like a starting section apart from it", () => {
    const people = peopleOf([
      shift("1", { id: "a", name: "Mia", roles: [MANAGER] }),
      shift("2", { id: "b", name: "Kai", roles: [custom("Managers")] }),
    ]);
    expect(sectionsOf(people).map((s) => s.people.map((p) => p.name))).toEqual([["Mia"], ["Kai"]]);
  });

  it("works without roles from an older server: everyone under Other", () => {
    const old = shift("1", ANA);
    old.employee = { id: "u1", display_name: "Ana Diaz" };
    expect(sectionsOf(peopleOf([old])).map((s) => s.title)).toEqual(["Other"]);
  });
});

describe("hours", () => {
  it("adds up each person's shifts by their real length, overnight ones included, and leaves open shifts out", () => {
    const people = peopleOf([
      shift("1", ANA),
      // 22:00 to 06:00 in Chicago: 8 hours across midnight.
      shift("2", ANA, { starts_at: "2026-10-07T03:00:00Z", ends_at: "2026-10-07T11:00:00Z" }),
      // 4.5 hours.
      shift("3", BEN, { starts_at: "2026-10-06T14:00:00Z", ends_at: "2026-10-06T18:30:00Z" }),
      shift("4", null),
    ]);
    expect(people.map((p) => [p.name, p.hours])).toEqual([
      ["Ana Diaz", 16],
      ["Ben Okafor", 4.5],
    ]);
  });
});

describe("search", () => {
  it("needs every word typed, in any order, ignoring capitals", () => {
    expect(nameMatches("Ana Diaz", "ana di")).toBe(true);
    expect(nameMatches("Ana Diaz", "DIAZ ana")).toBe(true);
    expect(nameMatches("Ana Park", "ana di")).toBe(false);
    expect(nameMatches("Ana Diaz", "   ")).toBe(true);
  });

  it("combines with the toggles: shown only if the name matches AND the person is on", () => {
    const filters = noFilters();
    expect(isFiltering(filters)).toBe(false);
    filters.query = "ana";
    expect(isShown(filters, ANA)).toBe(true);
    expect(isShown(filters, BEN)).toBe(false);
    filters.hidden.add(ANA.id);
    expect(isShown(filters, ANA)).toBe(false);
    expect(isFiltering(filters)).toBe(true);
  });
});

describe("the menu", () => {
  /** @param {ReturnType<typeof noFilters>} filters */
  function build(filters, onChange = vi.fn()) {
    const people = peopleOf([shift("1", ANA), shift("2", ANA_PARK), shift("3", BEN)]);
    const menu = peopleMenu(people, filters, onChange);
    document.body.append(menu);
    return { menu, onChange };
  }
  /** @param {string} name */
  const toggle = (name) =>
    /** @type {HTMLButtonElement} */ (
      [...document.querySelectorAll(".people-menu__person")].find((b) =>
        b.textContent?.includes(name),
      )
    );

  it("is a labelled region with a labelled search and a polite count", () => {
    const { menu } = build(noFilters());
    expect(menu.getAttribute("aria-labelledby")).toBe("people-menu-heading");
    expect(document.getElementById("people-menu-heading")?.textContent).toBe("People");
    expect(document.querySelector('label[for="people-search"]')?.textContent).toBe("Search names");
    const count = menu.querySelector(".people-menu__count");
    expect(count?.getAttribute("aria-live")).toBe("polite");
    expect(count?.textContent).toBe("3 of 3 people shown");
    expect(menu.querySelector(".people-menu__clear")?.hasAttribute("disabled")).toBe(true);
  });

  it("shows each name with its colour and hours, as a pressed toggle button", () => {
    build(noFilters());
    const ana = toggle("Ana Diaz");
    expect(ana.getAttribute("aria-pressed")).toBe("true");
    expect(ana.className).toMatch(/person-colour-\d+/);
    expect(ana.querySelector(".people-menu__hours")?.textContent).toBe("8 h");
    expect(ana.querySelector(".people-menu__hours")?.getAttribute("aria-hidden")).toBe("true");
    // Screen readers hear the whole word.
    expect(ana.querySelector(".visually-hidden")?.textContent).toBe(", 8 hours");
  });

  it("switches a person off and on with a click", () => {
    const filters = noFilters();
    const { menu, onChange } = build(filters);
    toggle("Ben Okafor").click();
    expect(filters.hidden.has(BEN.id)).toBe(true);
    expect(toggle("Ben Okafor").getAttribute("aria-pressed")).toBe("false");
    expect(menu.querySelector(".people-menu__count")?.textContent).toBe("2 of 3 people shown");
    expect(onChange).toHaveBeenCalledTimes(1);
    toggle("Ben Okafor").click();
    expect(filters.hidden.size).toBe(0);
  });

  it("hides or shows a whole section with its own button", () => {
    const filters = noFilters();
    build(filters);
    const employees = /** @type {HTMLButtonElement} */ (
      document.querySelector('[aria-label="Hide all Employees"]')
    );
    expect(employees.textContent).toBe("Hide all");
    employees.click();
    expect([...filters.hidden].sort()).toEqual([ANA_PARK.id, BEN.id]);
    // The managers were not touched.
    expect(filters.hidden.has(ANA.id)).toBe(false);
    expect(employees.textContent).toBe("Show all");
    expect(employees.getAttribute("aria-label")).toBe("Show all Employees");
    employees.click();
    expect(filters.hidden.size).toBe(0);
  });

  it("narrows the list as it searches, leaving out sections with nobody matching", () => {
    const filters = noFilters();
    const { menu } = build(filters);
    const search = /** @type {HTMLInputElement} */ (document.getElementById("people-search"));
    search.value = "ana di";
    search.dispatchEvent(new Event("input"));
    expect(filters.query).toBe("ana di");
    const visible = [...menu.querySelectorAll(".people-menu__list li")]
      .filter((li) => !(/** @type {HTMLElement} */ (li).hidden))
      .map((li) => li.querySelector(".people-menu__name")?.textContent);
    expect(visible).toEqual(["Ana Diaz"]);
    const sections = [...menu.querySelectorAll(".people-menu__section")];
    expect(sections.map((s) => /** @type {HTMLElement} */ (s).hidden)).toEqual([false, true]);
    expect(menu.querySelector(".people-menu__count")?.textContent).toBe("1 of 3 people shown");
  });

  it("clears every filter with one button", () => {
    const filters = noFilters();
    filters.hidden.add(BEN.id);
    filters.query = "ana";
    const { menu, onChange } = build(filters);
    // The search box starts with the page's search (from an earlier week).
    const search = /** @type {HTMLInputElement} */ (document.getElementById("people-search"));
    expect(search.value).toBe("ana");
    const clear = /** @type {HTMLButtonElement} */ (menu.querySelector(".people-menu__clear"));
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(filters.hidden.size).toBe(0);
    expect(filters.query).toBe("");
    expect(search.value).toBe("");
    expect(clear.disabled).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shows names and role names as text, never as HTML", () => {
    const xss = "<img src=x onerror=alert(1)>";
    const people = peopleOf([shift("1", { id: "x", name: xss, roles: [custom(xss)] })]);
    const menu = peopleMenu(people, noFilters(), () => {});
    expect(menu.querySelector("img")).toBeNull();
    expect(menu.querySelector(".people-menu__name")?.textContent).toBe(xss);
    expect(menu.querySelector(".people-menu__title")?.textContent).toBe(xss);
  });
});

describe("showPeople on the calendar", () => {
  it("hides the blocks of people switched off, and gives the others the day's width back", () => {
    // Ana and Ben overlap on Monday, so each first takes half the day.
    const calendar = weekCalendar(KEYS, [
      shift("a", ANA),
      shift("b", BEN, { starts_at: "2026-10-05T15:00:00Z", ends_at: "2026-10-05T20:00:00Z" }),
    ]);
    const block = (/** @type {string} */ id) =>
      /** @type {HTMLElement} */ (calendar.querySelector(`[data-shift="${id}"]`));
    expect(block("a").style.getPropertyValue("--block-columns")).toBe("2");

    showPeople(calendar, (id) => id !== BEN.id);
    expect(block("b").hidden).toBe(true);
    expect(block("a").hidden).toBe(false);
    expect(block("a").style.getPropertyValue("--block-columns")).toBe("1");
    expect(block("a").style.getPropertyValue("--block-column")).toBe("0");

    // Everyone again: the columns are as weekCalendar placed them.
    showPeople(calendar, () => true);
    expect(block("b").hidden).toBe(false);
    expect(block("a").style.getPropertyValue("--block-columns")).toBe("2");
    expect(block("b").style.getPropertyValue("--block-column")).toBe("1");
  });
});

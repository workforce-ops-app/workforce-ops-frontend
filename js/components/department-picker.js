// The department picker in the department week's heading
// (workforce-ops-app/workforce-ops-frontend#82): a labelled list of the departments the
// person may see, with the one shown selected. Choosing another shows the same week for
// that department, and the address says which (?department=<id>), so the choice can still
// be bookmarked or shared. A company with only one department has nothing to choose, so
// the picker stays hidden there.
//
// The departments list comes from the server (GET /api/departments), which already keeps
// it to the person's own company. Department names are written by users, so each option's
// name goes through el() as text, and the value is the server's ID only.

import { el } from "../core/dom.js";

/** The first option when the department shown is not in the list (an unavailable one). */
export const CHOOSE = "Choose a department";

/**
 * Fill the picker with the departments and select the one shown. Called for every week
 * the page loads, so the list is always the one that came with that week.
 * @param {HTMLElement} picker the wrapper (#department-picker) holding the label and the
 *   <select>
 * @param {import("../api/shifts.js").DepartmentRef[]} departments
 * @param {string | null} currentId the department shown
 */
export function showDepartmentPicker(picker, departments, currentId) {
  const select = picker.querySelector("select");
  if (!select) return;

  // Step 1: one option per department, its ID as the value and its name as text.
  const options = departments.map((department) =>
    el("option", { text: department.name, attrs: { value: department.id } }),
  );
  // Step 2: a department that is not in the list (another company's ID, a deleted one, a
  // typo; the page says it is unavailable) cannot be selected, so a first option says
  // "Choose a department" instead of pretending the first department is shown.
  const known = departments.some((department) => department.id === currentId);
  if (!known) {
    options.unshift(
      el("option", { text: CHOOSE, attrs: { value: "", disabled: "", selected: "" } }),
    );
  }
  select.replaceChildren(...options);
  select.value = known && currentId !== null ? currentId : "";

  // Step 3: shown only when there is a choice to make.
  picker.hidden = departments.length < 2;
}

/**
 * Make choosing a department show it, in place, like the week links: the address changes
 * with history.pushState (so Back returns to the department before) and only the week is
 * loaded again, through the same queue as the week links, so the two never race.
 * @param {(search: string) => Promise<void>} load the week loader from followWeekLinks
 */
export function followDepartmentPicker(load) {
  const select = document.querySelector("#department-picker select");
  if (!(select instanceof HTMLSelectElement)) return;
  select.addEventListener("change", () => {
    if (!select.value) return;
    // The same address with the new department: the week (and anything else) stays.
    // URLSearchParams escapes the value, so an ID can only ever be a value.
    const params = new URLSearchParams(window.location.search);
    params.set("department", select.value);
    const search = `?${params}`;
    window.history.pushState(null, "", search);
    void load(search);
  });
}

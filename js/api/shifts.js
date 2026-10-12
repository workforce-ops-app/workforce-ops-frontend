// Shifts from the API: the functions the schedule screens use.
//
// Course topics: REST and AJAX. Each function asks the server for one collection (shifts,
// departments, people) with a GET, in the background, and the page then fills itself in
// from the JSON answer without reloading. Every request goes through js/api/client.js, so
// the session cookie goes to our own server only and every failure becomes an ApiError or
// a NetworkError the page can explain.
//
// The server decides what each person may see: it filters every list to the signed-in
// person's company, and to what their schedule.view scope covers. These functions only
// pass on what the page asks for; asking for another company's department answers 404.
//
// The API answer (backend schedules feature, decision 0026: JSON, snake_case, UTC moments,
// paged lists with a cursor):
//   GET /api/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD[&department_id=...][&mine=true][&cursor=...]
//   { "items": [Shift, ...], "next_cursor": "..." | null }
// where a Shift is
//   { id, department: { id, name }, employee: { id, display_name } | null,
//     starts_at, ends_at, timezone, status, details, notes, event_name, event_description }

import { api } from "./client.js";

/**
 * @typedef {{ id: string, name: string }} DepartmentRef
 * @typedef {{ id: string, display_name: string }} EmployeeRef
 * @typedef {{
 *   id: string, department: DepartmentRef, employee: EmployeeRef | null,
 *   starts_at: string, ends_at: string, timezone: string,
 *   status: "scheduled" | "open" | "cancelled",
 *   details: string | null, notes: string | null,
 *   event_name: string | null, event_description: string | null
 * }} Shift
 * @typedef {{ from: string, to: string, departmentId?: string, mine?: boolean }} ShiftQuery
 *   from and to are day keys ("YYYY-MM-DD"), both included
 */

/**
 * Every shift matching the query, from GET /api/shifts, following the pages.
 * @param {ShiftQuery} query
 * @returns {Promise<Shift[]>}
 */
export async function listShifts(query) {
  // Build the query string. URLSearchParams escapes every value, so an ID or date can
  // never break out of its parameter.
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.departmentId) params.set("department_id", query.departmentId);
  if (query.mine) params.set("mine", "true");
  return fetchAll(params, "/api/shifts");
}

/**
 * The company's active departments (id and name only), sorted by name, for naming the
 * department a week belongs to. From GET /api/departments, which anyone signed in may
 * call (backend organization feature, workforce-ops-backend#88).
 * @returns {Promise<DepartmentRef[]>}
 */
export async function listDepartments() {
  return fetchAll(new URLSearchParams(), "/api/departments");
}

/**
 * Everyone whose home department is the given one, for the department week's
 * "Unscheduled employees" section. From GET /api/users (backend organization feature,
 * workforce-ops-backend#54, after the midterm), filtered to the department.
 * The API answers only with the people the signed-in person may see (user.view and its
 * scope). Someone without that right gets 403, and until the endpoint exists every call
 * gets 404; the page leaves the section out in both cases.
 * @param {string} departmentId
 * @returns {Promise<EmployeeRef[]>}
 */
export async function listDepartmentPeople(departmentId) {
  return fetchAll(new URLSearchParams({ department_id: departmentId }), "/api/users");
}

/**
 * Every item of a paged list (decision 0026). The API sends long lists a page at a time;
 * each page names the cursor of the next one, until next_cursor is null.
 * @param {URLSearchParams} params the list's filters
 * @param {string} path e.g. "/api/shifts"
 * @returns {Promise<any[]>}
 */
async function fetchAll(params, path) {
  /** @type {any[]} */
  const items = [];
  /** @type {string | null} */
  let cursor = null;
  do {
    if (cursor) params.set("cursor", cursor);
    const query = params.size > 0 ? `?${params}` : "";
    const page = await api.get(`${path}${query}`);
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return items;
}

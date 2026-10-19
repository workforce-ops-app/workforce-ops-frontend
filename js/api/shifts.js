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
// pass on what the page asks for; another company's department simply has no shifts the
// person may see, so the list comes back empty (the department week checks the ID first, #47).
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

// --- Changing shifts (edit mode, workforce-ops-app/workforce-ops-frontend#16) -----------
//
// Course topics: REST and CSRF. Each change is a POST or PATCH to the shift it is about,
// and api.post/api.patch add the X-CSRF-Token header (js/api/client.js), so another site
// cannot make a signed-in manager's browser send one of these. The server checks
// schedule.edit and its scope on every request; the page only hides the buttons.
//
// Times are sent as UTC moments. The page turns the workplace's wall-clock times into
// moments first (zonedTimeToUtc in js/core/time.js), as the backend expects.

/**
 * @typedef {{
 *   starts_at?: string, ends_at?: string, details?: string | null, notes?: string | null,
 *   event_name?: string | null, event_description?: string | null
 * }} ShiftChanges the fields of a shift that PATCH may change; only the ones sent change
 * @typedef {ShiftChanges & { department_id: string, employee_id: string | null,
 *   starts_at: string, ends_at: string }} NewShift
 * @typedef {{ starts_at: string, ends_at: string }} ShiftTimes
 * @typedef {(
 *   | { action: "create", department_id: string, employee_id: string | null,
 *       times: ShiftTimes[], details?: string | null, notes?: string | null,
 *       event_name?: string | null, event_description?: string | null,
 *       confirm_count?: number }
 *   | { action: "cancel", shift_ids: string[], confirm_count?: number }
 *   | { action: "assign", shift_ids: string[], employee_id: string | null,
 *       confirm_count?: number }
 * )} ShiftBatch one body per action, as the backend's POST /api/shifts/batch accepts
 */

/**
 * Add one shift (POST /api/shifts). employee_id null makes it an open shift.
 * @param {NewShift} shift
 * @returns {Promise<Shift>} the shift as saved
 */
export function createShift(shift) {
  return api.post("/api/shifts", shift);
}

/**
 * Change a shift's times or text (PATCH /api/shifts/{id}); fields left out stay as they are.
 * @param {string} id
 * @param {ShiftChanges} changes
 * @returns {Promise<Shift>}
 */
export function updateShift(id, changes) {
  return api.patch(`/api/shifts/${encodeURIComponent(id)}`, changes);
}

/**
 * Give a shift to a person, or make it open again with null (POST /api/shifts/{id}/assign).
 * @param {string} id
 * @param {string | null} employeeId
 * @returns {Promise<Shift>}
 */
export function assignShift(id, employeeId) {
  return api.post(`/api/shifts/${encodeURIComponent(id)}/assign`, { employee_id: employeeId });
}

/**
 * Cancel a shift (POST /api/shifts/{id}/cancel). It stays in the audit log, but leaves the
 * week and can no longer be changed.
 * @param {string} id
 * @returns {Promise<Shift>}
 */
export function cancelShift(id) {
  return api.post(`/api/shifts/${encodeURIComponent(id)}/cancel`);
}

/**
 * Change several shifts at once, all or nothing (POST /api/shifts/batch). From 10 shifts
 * on, the body must repeat the count in confirm_count (decision 0025, threat D3), or the
 * server saves nothing and answers 409.
 * @param {ShiftBatch} batch
 * @returns {Promise<{ action: string, count: number, items: Shift[] }>}
 */
export function batchShifts(batch) {
  return api.post("/api/shifts/batch", batch);
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

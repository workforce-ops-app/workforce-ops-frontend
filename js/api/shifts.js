// Shifts from the API: the functions the schedule screens use.
//
// Until the shifts API exists (backend SC1, workforce-ops-backend#61), the screens read
// sample data shaped exactly like its answer (sample-shifts.js). That file is loaded only
// when it is needed (import() below), so with USE_SAMPLE_DATA set to false the browser
// never asks for it. Connecting the real API (frontend task 17):
//   1. set USE_SAMPLE_DATA to false: the screens now use the API, nothing else changes;
//   2. delete sample-shifts.js, sampleData() and the USE_SAMPLE_DATA branches below (the
//      type check names every line that still refers to them).
//
// The API answer, agreed for SC1 (decision 0026: JSON, snake_case, UTC moments, paged
// lists with a cursor):
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

/** Sample data until backend SC1 exists; see the top of this file. */
export const USE_SAMPLE_DATA = true;

/**
 * The sample data module, loaded the first time it is needed. A dynamic import() is still
 * a same-site script, so the Content Security Policy (script-src 'self') allows it.
 */
function sampleData() {
  return import("./sample-shifts.js");
}

/**
 * The shifts the screens show: sample data for now, the real API once it exists.
 * @param {ShiftQuery} query
 * @returns {Promise<Shift[]>}
 */
export async function listShifts(query) {
  return USE_SAMPLE_DATA ? (await sampleData()).sampleShifts(query) : fetchShifts(query);
}

/**
 * The company's departments, for naming the department a week belongs to.
 * From GET /api/departments (backend organization feature), paged like every list.
 * @returns {Promise<DepartmentRef[]>}
 */
export async function listDepartments() {
  if (USE_SAMPLE_DATA) return (await sampleData()).SAMPLE_DEPARTMENTS;
  return fetchAll(new URLSearchParams(), "/api/departments");
}

/**
 * The signed-in person's own (home) department, which the department week shows when the
 * address names none. From GET /api/sessions/current, which already answers "who am I"
 * on every page; null for someone without a home department.
 * @returns {Promise<string | null>}
 */
export async function myDepartmentId() {
  if (USE_SAMPLE_DATA) return (await sampleData()).SAMPLE_MY_DEPARTMENT_ID;
  const session = await api.get("/api/sessions/current");
  return session.user?.department_id ?? null;
}

/**
 * Every shift matching the query, from GET /api/shifts, following the pages.
 * @param {ShiftQuery} query
 * @returns {Promise<Shift[]>}
 */
export async function fetchShifts(query) {
  // Build the query string. URLSearchParams escapes every value, so an ID or date can
  // never break out of its parameter.
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.departmentId) params.set("department_id", query.departmentId);
  if (query.mine) params.set("mine", "true");
  return fetchAll(params, "/api/shifts");
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

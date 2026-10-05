// Shifts from the API: the functions the schedule screens use.
//
// Until the shifts API exists (backend SC1, workforce-ops-backend#61), the screens read
// sample data shaped exactly like its answer (sample-shifts.js). Connecting the real API
// (frontend task 17) means setting USE_SAMPLE_DATA to false and deleting sample-shifts.js;
// the screens do not change.
//
// The API answer, agreed for SC1 (decision 0026: JSON, snake_case, UTC moments, paged
// lists with a cursor):
//   GET /api/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD[&department_id=...][&mine=true][&cursor=...]
//   { "items": [Shift, ...], "next_cursor": "..." | null }
// where a Shift is
//   { id, department: { id, name }, employee: { id, display_name } | null,
//     starts_at, ends_at, timezone, status, details, notes, event_name, event_description }

import { api } from "./client.js";
import { sampleShifts } from "./sample-shifts.js";

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
 * The shifts the screens show: sample data for now, the real API once it exists.
 * @param {ShiftQuery} query
 * @returns {Promise<Shift[]>}
 */
export function listShifts(query) {
  return USE_SAMPLE_DATA ? sampleShifts(query) : fetchShifts(query);
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

  // The API sends long lists a page at a time; each page names the cursor of the next
  // one, until next_cursor is null.
  /** @type {Shift[]} */
  const shifts = [];
  /** @type {string | null} */
  let cursor = null;
  do {
    if (cursor) params.set("cursor", cursor);
    const page = await api.get(`/api/shifts?${params}`);
    shifts.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return shifts;
}

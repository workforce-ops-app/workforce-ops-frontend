// Security events from the API: what the detection layer recorded for the signed-in
// person's company (slice DT7; backend docs, features/detection.md, "Backend").
//
// Detection only records; it never blocks a request. Each event is a request whose input
// looked like an attack: which pattern matched, in which field, on which route, from whom,
// and an excerpt of the text. The excerpt is attacker text, so the page shows it with
// textContent only (threat T7).
//
// Both endpoints need security.view (Owner and Administrator); anyone else gets 403, so
// hiding the page is a convenience and the API is the protection (E8).
//
// The API answers (decision 0026: JSON, snake_case, UTC moments, paged lists):
//   GET /api/security-events?kind=&user_id=&from=&to=&cursor=&limit=
//     { "items": [SecurityEvent, ...], "next_cursor": "..." | null }   newest first
//     from and to are days (YYYY-MM-DD) in the company's time zone, both included
//   GET /api/security-events/summary
//     { "kinds": [{ "kind": "...", "last_7_days": 3, "last_30_days": 9 }, ...] }

import { api } from "./client.js";

/**
 * @typedef {{
 *   id: string, kind: string, pattern_id: string | null, field: string | null,
 *   method: string | null, route: string | null, user_id: string | null,
 *   user_name: string | null, client_address: string | null, request_id: string | null,
 *   excerpt: string | null, count: number, occurred_at: string,
 * }} SecurityEvent excerpt is exactly what was stored: attacker text, never HTML
 * @typedef {{ items: SecurityEvent[], next_cursor: string | null }} SecurityEventPage
 * @typedef {{ kind: string, last_7_days: number, last_30_days: number }} KindCount
 * @typedef {{
 *   kind?: string, userId?: string, from?: string, to?: string,
 *   cursor?: string | null, limit?: number,
 * }} EventFilters empty values are left out
 */

/**
 * One page of the company's security events, newest first.
 * @param {EventFilters} [filters]
 * @returns {Promise<SecurityEventPage>}
 */
export function listSecurityEvents(filters = {}) {
  // URLSearchParams escapes every value, so a filter can never break out of its parameter.
  const params = new URLSearchParams();
  /** @type {[string, string | number | null | undefined][]} */
  const values = [
    ["kind", filters.kind],
    ["user_id", filters.userId],
    ["from", filters.from],
    ["to", filters.to],
    ["cursor", filters.cursor],
    ["limit", filters.limit],
  ];
  for (const [name, value] of values) {
    if (value !== null && value !== undefined && value !== "") params.set(name, String(value));
  }
  const query = params.size > 0 ? `?${params}` : "";
  return api.get(`/api/security-events${query}`);
}

/**
 * The counts per kind for the last 7 and 30 days, every kind included (zero too).
 * @returns {Promise<KindCount[]>}
 */
export async function securitySummary() {
  /** @type {{ kinds: KindCount[] }} */
  const answer = await api.get("/api/security-events/summary");
  return answer.kinds;
}

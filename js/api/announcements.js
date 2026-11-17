// Announcements from the API: the requests the announcements page and the home screen use
// to read them (slice AN4). Posting, editing, archiving, and the read list come with AN5.
//
// Course topics: REST, AJAX, and CSRF. Reading is a GET in the background, and the page
// fills itself in from the JSON answer. Marking one read is a POST, so api.post adds the
// X-CSRF-Token header (js/api/client.js) and another site cannot mark announcements read
// in someone's name.
//
// The server decides what each person may see: the list holds only the active
// announcements whose audience includes the signed-in person (threat I9), so the page
// shows whatever it is given and never filters by itself.
//
// The API answer (backend announcements design, decision 0026: JSON, snake_case, UTC
// moments, paged lists with a cursor):
//   GET /api/announcements?cursor=&limit=   newest first
//   { "items": [Announcement, ...], "next_cursor": "..." | null }
//   POST /api/announcements/{id}/read        204, the same again changes nothing
//                                            404 when the person is not in its audience

import { api } from "./client.js";

/**
 * @typedef {{
 *   type: "company" | "department" | "team",
 *   department_id: string | null, department_name: string | null,
 *   team_id: string | null, team_name: string | null
 * }} Audience who an announcement is for; for a team, department_id is null
 * @typedef {{
 *   id: string, audience: Audience, title: string, body: string,
 *   author: { id: string, display_name: string },
 *   posted_at: string, edited_at: string | null, archived: boolean, read: boolean
 * }} Announcement title and body are plain text with **bold** (never HTML)
 * @typedef {{ items: Announcement[], next_cursor: string | null }} AnnouncementPage
 */

/**
 * One page of the person's announcements, newest first (GET /api/announcements). The
 * page asks for more with the next_cursor of the page before, when the person wants them,
 * rather than loading every announcement at once.
 * @param {{ cursor?: string | null, limit?: number }} [options] limit: how many at most
 *   (the server's default when left out)
 * @returns {Promise<AnnouncementPage>}
 */
export function listAnnouncements(options = {}) {
  // URLSearchParams escapes every value, so a cursor can never break out of its parameter.
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const query = params.size > 0 ? `?${params}` : "";
  return api.get(`/api/announcements${query}`);
}

/**
 * Record that the signed-in person has read an announcement
 * (POST /api/announcements/{id}/read). Safe to send twice: the server keeps one mark.
 * @param {string} id
 * @returns {Promise<null>} the 204 answer has no content
 */
export function markAnnouncementRead(id) {
  // encodeURIComponent keeps the ID inside its part of the address, so an ID from the
  // server can never point the request somewhere else.
  return api.post(`/api/announcements/${encodeURIComponent(id)}/read`);
}

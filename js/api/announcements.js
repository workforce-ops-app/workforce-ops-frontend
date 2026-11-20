// Announcements from the API: the requests the announcements page and the home screen use
// to read them (slice AN4), and the ones the managing page uses to post, correct, and
// archive them and to see who has read them (slice AN5).
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
//
// Managing (needs announcement.create covering the audience; the server decides, E11):
//   GET   /api/announcements/audiences       { items: [AudienceChoice, ...] }, 403 without
//                                            announcement.create anywhere
//   POST  /api/announcements                 201 the new one (ManagedAnnouncement)
//   GET   /api/announcements/managed?cursor=&limit=&include_archived=
//                                            { items: [ManagedAnnouncement, ...], next_cursor }
//   PATCH /api/announcements/{id}            { title?, body? }  200
//   POST  /api/announcements/{id}/archive    200
//   GET   /api/announcements/{id}/reads?cursor=&limit=
//                                            { items: [Reader, ...], next_cursor }

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
 * @typedef {Omit<Announcement, "read"> & { read_count: number, audience_count: number }}
 *   ManagedAnnouncement one the person manages, with how many of its audience have read it
 * @typedef {{ items: ManagedAnnouncement[], next_cursor: string | null }} ManagedPage
 * @typedef {{
 *   type: "company" | "department" | "team",
 *   department_id: string | null, team_id: string | null,
 *   name: string | null, department_name: string | null
 * }} AudienceChoice an audience the person may post to: type and the IDs are what the POST
 *   body needs; name is the department's or team's (null for the company); department_name
 *   is a team's department, for the screen only
 * @typedef {{ id: string, display_name: string, read_at: string | null }} Reader someone in
 *   the audience; read_at null: not read yet
 * @typedef {{ items: Reader[], next_cursor: string | null }} ReaderPage
 */

/**
 * A query string from the parameters that are set, e.g. "?cursor=abc&limit=20", or "".
 * URLSearchParams escapes every value, so a cursor can never break out of its parameter.
 * @param {Record<string, string | number | null | undefined>} values
 * @returns {string}
 */
function query(values) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== "") params.set(name, String(value));
  }
  return params.size > 0 ? `?${params}` : "";
}

/**
 * The address of one announcement (or of one of its parts). encodeURIComponent keeps the
 * ID inside its part of the address, so an ID from the server can never point the request
 * somewhere else.
 * @param {string} id
 * @param {string} [part] e.g. "archive"
 * @returns {string}
 */
function one(id, part) {
  const path = `/api/announcements/${encodeURIComponent(id)}`;
  return part ? `${path}/${part}` : path;
}

/**
 * One page of the person's announcements, newest first (GET /api/announcements). The
 * page asks for more with the next_cursor of the page before, when the person wants them,
 * rather than loading every announcement at once.
 * @param {{ cursor?: string | null, limit?: number }} [options] limit: how many at most
 *   (the server's default when left out)
 * @returns {Promise<AnnouncementPage>}
 */
export function listAnnouncements(options = {}) {
  return api.get(`/api/announcements${query({ cursor: options.cursor, limit: options.limit })}`);
}

/**
 * Record that the signed-in person has read an announcement
 * (POST /api/announcements/{id}/read). Safe to send twice: the server keeps one mark.
 * @param {string} id
 * @returns {Promise<null>} the 204 answer has no content
 */
export function markAnnouncementRead(id) {
  return api.post(one(id, "read"));
}

/**
 * The audiences the person may post to, worked out by the server with the same check
 * posting makes (GET /api/announcements/audiences). The form offers only these; the
 * server still checks the one sent.
 * @returns {Promise<AudienceChoice[]>}
 */
export async function listAudiences() {
  /** @type {{ items: AudienceChoice[] }} */
  const answer = await api.get("/api/announcements/audiences");
  return answer.items;
}

/**
 * Post a new announcement (POST /api/announcements).
 * @param {{
 *   audience_type: string, department_id?: string, team_id?: string,
 *   title: string, body: string,
 * }} announcement only the ID the audience type needs
 * @returns {Promise<ManagedAnnouncement>}
 */
export function postAnnouncement(announcement) {
  return api.post("/api/announcements", announcement);
}

/**
 * One page of the announcements the person manages, newest first
 * (GET /api/announcements/managed), with their read counts.
 * @param {{ cursor?: string | null, limit?: number, includeArchived?: boolean }} [options]
 * @returns {Promise<ManagedPage>}
 */
export function listManaged(options = {}) {
  const values = {
    cursor: options.cursor,
    limit: options.limit,
    include_archived: options.includeArchived ? "true" : null,
  };
  return api.get(`/api/announcements/managed${query(values)}`);
}

/**
 * Correct an announcement's title or message (PATCH /api/announcements/{id}): only the
 * fields given change. Who has read it stays as it was.
 * @param {string} id
 * @param {{ title?: string, body?: string }} changes
 * @returns {Promise<ManagedAnnouncement>}
 */
export function editAnnouncement(id, changes) {
  return api.patch(one(id), changes);
}

/**
 * Archive an announcement (POST /api/announcements/{id}/archive): readers no longer see
 * it; it stays in the managing list for history and cannot be changed again.
 * @param {string} id
 * @returns {Promise<ManagedAnnouncement>}
 */
export function archiveAnnouncement(id) {
  return api.post(one(id, "archive"));
}

/**
 * One page of the people in an announcement's audience, by name, each with when they
 * read it (GET /api/announcements/{id}/reads).
 * @param {string} id
 * @param {{ cursor?: string | null, limit?: number }} [options]
 * @returns {Promise<ReaderPage>}
 */
export function listReaders(id, options = {}) {
  return api.get(`${one(id, "reads")}${query({ cursor: options.cursor, limit: options.limit })}`);
}

// Approval requests (backend authorization.md, approval requests). A change at the
// person's own level (a role, an owner change) waits here until someone above decides.
// Used by the Approvals screen.
//
// Time-off requests have their own screens and endpoints (the generic decision refuses
// them with 409), so the Approvals screen leaves them out.

import { api } from "./client.js";

/**
 * @typedef {{ id: string, display_name: string }} Reviewer
 * @typedef {{
 *   id: string, kind: string, status: "pending" | "approved" | "denied" | "cancelled",
 *   requested_by: string, subject_user_id: string, payload: Record<string, unknown>,
 *   required_approvals: number, review_by: string, not_reviewed: boolean,
 *   created_at: string, decided_at: string | null, reviewers: Reviewer[],
 *   requested_by_name: string, subject_name: string, role_name: string | null,
 *   scope_name?: string | null,
 * }} ApprovalRequest
 */

/**
 * The requests the person made or that are about them ("mine"), or the pending ones they
 * may decide now ("to_review").
 * @param {"mine" | "to_review"} view
 * @returns {Promise<ApprovalRequest[]>}
 */
export async function listRequests(view) {
  const answer = await api.get(
    `/api/approval-requests?${new URLSearchParams({ view, limit: "100" })}`,
  );
  return answer.items;
}

/**
 * Approve or deny a request (as a reviewer), or cancel one's own.
 * @param {string} id
 * @param {"approve" | "deny" | "cancel"} decision
 * @returns {Promise<ApprovalRequest>}
 */
export function decide(id, decision) {
  return api.post(`/api/approval-requests/${encodeURIComponent(id)}/${decision}`);
}

import { apiFetch } from "./api";
import type { components } from "./api-types";

export type InviteCodeStatus =
  components["schemas"]["AdminInviteCodeRead"]["status"];

/** One onboarding invite row. ``x_handle`` is the handle the code binds;
 *  redemption copies it onto the new account as its bot-attribution link. */
export type InviteCode = components["schemas"]["AdminInviteCodeRead"];

export interface CreateInviteCodeBody {
  expires_in_days: number | null;
  x_handle?: string | null;
}

/** `GET /admin/invite-codes` for one page of the table.
 *
 *  A path rather than a fetch: the response is capped like every other list,
 *  so the console reads the append-only table through `useCursorList`, which
 *  builds each request from the `Link: rel="next"` cursor of the page before.
 */
export function inviteCodesPath(cursor: string | null): string {
  return `/admin/invite-codes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
}

export function createInviteCode(
  body: CreateInviteCodeBody
): Promise<InviteCode> {
  return apiFetch<InviteCode>("/admin/invite-codes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function revokeInviteCode(id: string): Promise<InviteCode> {
  return apiFetch<InviteCode>(`/admin/invite-codes/${id}`, {
    method: "DELETE",
  });
}

/** One row of the admin user search. ``email`` is NULL on legacy
 *  credential-less rows; ``x_handle`` is the handle the bot attributes mentions
 *  to (admin-linked, null when none is). */
export type AdminUser = components["schemas"]["AdminUserRead"];

export function searchUsers(query: string): Promise<AdminUser[]> {
  if (!query.trim()) return Promise.resolve([]);
  return apiFetch<AdminUser[]>(
    `/admin/users?q=${encodeURIComponent(query.trim())}`
  );
}

export function setUserXHandle(
  userId: string,
  body: { x_handle: string | null }
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/x-handle`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export interface AdminEventDeleteResponse {
  geolocation_id: string;
  title: string;
  mode: "soft" | "hard";
  deleted_at: string | null;
  /** Every file swept, source and proof roles alike (`proof_images` folded
   *  into `media`, so there's no separate proof-image tally). */
  media_count: number;
}

export function deleteEvent(
  id: string,
  options: { hard: boolean }
): Promise<AdminEventDeleteResponse> {
  const path = `/admin/events/${id}${options.hard ? "?hard=true" : ""}`;
  return apiFetch<AdminEventDeleteResponse>(path, { method: "DELETE" });
}

/** ``media_count`` is every file swept, source and proof roles alike
 *  (`proof_images` is folded into `media`, so there's no separate tally). */
export type AdminUserDeleteResponse =
  components["schemas"]["AdminUserDeleteResponse"];

export function deleteUser(
  id: string,
  options: { hard: boolean }
): Promise<AdminUserDeleteResponse> {
  const path = `/admin/users/${id}${options.hard ? "?hard=true" : ""}`;
  return apiFetch<AdminUserDeleteResponse>(path, { method: "DELETE" });
}

export type AdminPurgeDetectedResponse =
  components["schemas"]["AdminPurgeDetectedResponse"];

/** Hard-delete every `detected` draft the user owns, keeping the account.
 *  The broken-archive repair. */
export function purgeDetectedEvents(
  id: string
): Promise<AdminPurgeDetectedResponse> {
  return apiFetch<AdminPurgeDetectedResponse>(
    `/admin/users/${id}/detected-events`,
    { method: "DELETE" }
  );
}

// ── Moderation ────────────────────────────────────────────────────────

/** One page of the report queue: open reports first, newest first within each
 *  group. Offset-paged (not cursor-paged) because that leading open/resolved
 *  flag is not a column a keyset cursor can walk. */
export type ContentReportList = components["schemas"]["ContentReportList"];

/** The three verdicts that close a report. A report is resolved once: a second
 *  verdict is a 409. */
export type ContentReportResolution =
  components["schemas"]["ContentReportUpdate"]["resolution"];

export function reportsPath(page: number, perPage: number): string {
  return `/admin/reports?page=${page}&per_page=${perPage}`;
}

export function resolveReport(
  reportId: string,
  resolution: ContentReportResolution
): Promise<components["schemas"]["ContentReportRead"]> {
  return apiFetch<components["schemas"]["ContentReportRead"]>(
    `/admin/reports/${reportId}/resolve`,
    { method: "POST", body: JSON.stringify({ resolution }) }
  );
}

/** The moderation state of one event after the PATCH. `hidden_at` rather than
 *  a boolean, so the response also says when the takedown landed. */
export type AdminEventModeration =
  components["schemas"]["AdminEventModerationRead"];

/** Move either moderation axis directly, with no report behind it, and the one
 *  verb that undoes a takedown. Omitting an axis leaves it exactly as it is. */
export function setEventModeration(
  id: string,
  body: components["schemas"]["AdminEventModerationUpdate"]
): Promise<AdminEventModeration> {
  return apiFetch<AdminEventModeration>(`/admin/events/${id}/moderation`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ── Detection quality stats ───────────────────────────────────────────

/** Machine-extraction quality signal (admin-only). Definitions live on the
 *  backend `AdminDetectionStatsRead` schema. */
export type DetectionStats = components["schemas"]["AdminDetectionStatsRead"];

export function getDetectionStats(): Promise<DetectionStats> {
  return apiFetch<DetectionStats>("/admin/detection-stats");
}

// ── Maintenance ───────────────────────────────────────────────────────

/** One shape for every maintenance action; the UI renders only the keys present
 *  in the response. */
export type MaintenanceResponse =
  components["schemas"]["AdminMaintenanceResponse"];

export function reapAuthTokens(): Promise<MaintenanceResponse> {
  return apiFetch<MaintenanceResponse>("/admin/maintenance/reap-auth-tokens", {
    method: "POST",
  });
}

export function reapPendingRegistrations(): Promise<MaintenanceResponse> {
  return apiFetch<MaintenanceResponse>(
    "/admin/maintenance/reap-pending-registrations",
    { method: "POST" }
  );
}

/** Email every analyst holding unpublished `detected` drafts: one message with
 *  the count and a link to their own Detections queue. */
export function sendCompletionDigests(): Promise<MaintenanceResponse> {
  return apiFetch<MaintenanceResponse>(
    "/admin/maintenance/send-completion-digests",
    { method: "POST" }
  );
}

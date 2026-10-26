import { apiFetch } from "./api";
import type { components } from "./api-types";
import { withCursor } from "./pagination";

/** One onboarding invite row. ``x_handle`` is the handle the code binds;
 *  redemption copies it onto the new account as its bot-attribution link.
 *  ``sponsor`` is the analyst who minted it from Settings, null for an admin-minted code. */
export type InviteCode = components["schemas"]["AdminInviteCodeRead"];

type CreateInviteCodeBody = components["schemas"]["AdminInviteCodeCreate"];

/** `GET /admin/invite-codes` for one page; a path because the console reads it through
 *  `useCursorList`. */
export function inviteCodesPath(cursor: string | null): string {
  return withCursor("/admin/invite-codes", cursor);
}

export function createInviteCode(
  body: CreateInviteCodeBody
): Promise<InviteCode> {
  return apiFetch<InviteCode>("/admin/invite-codes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Retire a code, keeping its row: the table still lists it as `revoked`. */
export function revokeInviteCode(id: string): Promise<InviteCode> {
  return apiFetch<InviteCode>(`/admin/invite-codes/${id}/revoke`, {
    method: "POST",
  });
}

/** Drop the row of a code no account was created from. A redeemed code is
 *  refused with a 409: its row is the account's origin record. */
export function deleteInviteCode(id: string): Promise<void> {
  return apiFetch<void>(`/admin/invite-codes/${id}`, { method: "DELETE" });
}

/** One row of the admin user search. ``email`` is NULL on legacy
 *  credential-less rows; ``x_handle`` is the handle the bot attributes mentions
 *  to (admin-linked, null when none is); ``sponsor`` minted the code the account
 *  was created from. */
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

/** Turn minting invite codes from Settings on or off for one analyst. */
export function setUserInviteMinting(
  userId: string,
  enabled: boolean
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/invite-minting`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

/** `media_count` is every file swept, source and proof roles alike. */
export type AdminEventDeleteResponse =
  components["schemas"]["AdminEventDeleteResponse"];

export function deleteEvent(
  id: string,
  options: { hard: boolean }
): Promise<AdminEventDeleteResponse> {
  const path = `/admin/events/${id}${options.hard ? "?hard=true" : ""}`;
  return apiFetch<AdminEventDeleteResponse>(path, { method: "DELETE" });
}

/** `media_count` is every file swept, source and proof roles alike. */
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

/** Hard-delete every detection the user owns, keeping the account.
 *  The broken-archive repair. */
export function purgeDetectedEvents(
  id: string
): Promise<AdminPurgeDetectedResponse> {
  return apiFetch<AdminPurgeDetectedResponse>(
    `/admin/users/${id}/detected-events`,
    { method: "DELETE" }
  );
}

/** One page of the report queue: open first, newest first. Offset-paged since the
 *  open/resolved flag isn't a keyset column. */
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

/** Moderation state after the PATCH; `hidden_at` also says when the takedown landed. */
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

/** Machine-extraction quality signal (admin-only). Definitions live on the
 *  backend `AdminDetectionStatsRead` schema. */
export type DetectionStats = components["schemas"]["AdminDetectionStatsRead"];

export function getDetectionStats(): Promise<DetectionStats> {
  return apiFetch<DetectionStats>("/admin/detection-stats");
}

/** A site's takedown state after the PATCH: `hidden_at` is null once restored. */
export type AdminSiteModeration = components["schemas"]["AdminSiteModerationRead"];

/** Withhold a site from every public read, or restore it. */
export function setSiteModeration(id: string, hidden: boolean): Promise<AdminSiteModeration> {
  return apiFetch<AdminSiteModeration>(`/admin/sites/${encodeURIComponent(id)}/moderation`, {
    method: "PATCH",
    body: JSON.stringify({ hidden }),
  });
}

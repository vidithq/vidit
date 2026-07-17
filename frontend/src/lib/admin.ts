import { apiFetch } from "./api";
import type { components } from "./api-types";

export type InviteCodeStatus = "active" | "exhausted" | "revoked" | "expired";

export interface InviteCode {
  id: string;
  code: string;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  status: InviteCodeStatus;
  used_by_username: string | null;
  used_at: string | null;
  /** The X handle the code binds; redemption copies it onto the new
   *  account as its bot-attribution link. */
  x_handle: string | null;
}

export interface CreateInviteCodeBody {
  expires_in_days: number | null;
  x_handle?: string | null;
}

export function listInviteCodes(): Promise<InviteCode[]> {
  return apiFetch<InviteCode[]>("/admin/invite-codes");
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

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  is_admin: boolean;
  is_trusted: boolean;
  trust_reason: string | null;
  /** The X handle the bot attributes mentions to; admin-linked, null when
   *  no handle is linked. */
  x_handle: string | null;
  created_at: string;
}

export function searchUsers(query: string): Promise<AdminUser[]> {
  if (!query.trim()) return Promise.resolve([]);
  return apiFetch<AdminUser[]>(
    `/admin/users?q=${encodeURIComponent(query.trim())}`
  );
}

export function setUserTrust(
  userId: string,
  body: { is_trusted: boolean; trust_reason: string | null }
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/trust`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
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

export interface AdminUserDeleteResponse {
  user_id: string;
  username: string;
  mode: "soft" | "hard";
  deleted_at: string | null;
  cascaded_geolocations: number;
  /** Every file swept, source and proof roles alike (`proof_images` folded
   *  into `media`, so there's no separate proof-image tally). */
  media_count: number;
}

export function deleteUser(
  id: string,
  options: { hard: boolean }
): Promise<AdminUserDeleteResponse> {
  const path = `/admin/users/${id}${options.hard ? "?hard=true" : ""}`;
  return apiFetch<AdminUserDeleteResponse>(path, { method: "DELETE" });
}

// ── Demo data ─────────────────────────────────────────────────────────

export interface SeedDemoResponse {
  created: number;
  templates: number;
  authors: number;
}

export function seedDemo(count: number): Promise<SeedDemoResponse> {
  return apiFetch<SeedDemoResponse>("/admin/seed-demo", {
    method: "POST",
    body: JSON.stringify({ count }),
  });
}

export interface WipeDemoResponse {
  deleted_geos: number;
  deleted_users: number;
}

export function wipeDemo(): Promise<WipeDemoResponse> {
  return apiFetch<WipeDemoResponse>("/admin/seed-demo", {
    method: "DELETE",
  });
}

// ── Demo requests ─────────────────────────────────────────────────────

export interface SeedDemoRequestsResponse {
  created: number;
  templates: number;
  authors: number;
  with_claims: number;
  // Per-status breakdown so the admin can confirm the mix used; drives the
  // lifecycle UI (status chips + trace banner). Typed as required — the
  // schema bump shipped with the panel update, no compat window.
  open: number;
  fulfilled: number;
  closed: number;
}

export function seedDemoRequests(
  count: number
): Promise<SeedDemoRequestsResponse> {
  return apiFetch<SeedDemoRequestsResponse>("/admin/seed-demo-requests", {
    method: "POST",
    body: JSON.stringify({ count }),
  });
}

export interface WipeDemoRequestsResponse {
  deleted_requests: number;
}

export function wipeDemoRequests(): Promise<WipeDemoRequestsResponse> {
  return apiFetch<WipeDemoRequestsResponse>("/admin/seed-demo-requests", {
    method: "DELETE",
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

/** One shape for both reapers; the UI renders only the keys present in the
 *  response. Mirrors the backend `AdminMaintenanceResponse`. */
export interface MaintenanceResponse {
  expired?: number;
  old_consumed?: number;
  pending_registrations_deleted?: number;
}

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

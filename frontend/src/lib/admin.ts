import { apiFetch } from "./api";

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
}

export interface CreateInviteCodeBody {
  expires_in_days: number | null;
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

export interface AdminGeolocationDeleteResponse {
  geolocation_id: string;
  title: string;
  mode: "soft" | "hard";
  deleted_at: string | null;
  media_count: number;
  proof_image_count: number;
}

export function deleteGeolocation(
  id: string,
  options: { hard: boolean }
): Promise<AdminGeolocationDeleteResponse> {
  const path = `/admin/geolocations/${id}${options.hard ? "?hard=true" : ""}`;
  return apiFetch<AdminGeolocationDeleteResponse>(path, { method: "DELETE" });
}

export interface AdminUserDeleteResponse {
  user_id: string;
  username: string;
  mode: "soft" | "hard";
  deleted_at: string | null;
  cascaded_geolocations: number;
  media_count: number;
  proof_image_count: number;
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

// ── Demo bounties ─────────────────────────────────────────────────────

export interface SeedDemoBountiesResponse {
  created: number;
  templates: number;
  authors: number;
  with_claims: number;
  // Per-status breakdown from the seeder so the admin can confirm the
  // mix actually used. Drives the lifecycle UI coverage (status chips +
  // trace banner). Always present on a fresh backend; typed as required
  // because the schema bump landed in the same release as the panel
  // update — no compat window to preserve.
  open: number;
  fulfilled: number;
  closed: number;
}

export function seedDemoBounties(
  count: number
): Promise<SeedDemoBountiesResponse> {
  return apiFetch<SeedDemoBountiesResponse>("/admin/seed-demo-bounties", {
    method: "POST",
    body: JSON.stringify({ count }),
  });
}

export interface WipeDemoBountiesResponse {
  deleted_bounties: number;
}

export function wipeDemoBounties(): Promise<WipeDemoBountiesResponse> {
  return apiFetch<WipeDemoBountiesResponse>("/admin/seed-demo-bounties", {
    method: "DELETE",
  });
}

// ── Maintenance ───────────────────────────────────────────────────────

export interface MaintenanceResponse {
  expired?: number;
  old_consumed?: number;
  rows_deleted?: number;
  s3_deleted?: number;
  s3_failed?: number;
}

export function reapAuthTokens(): Promise<MaintenanceResponse> {
  return apiFetch<MaintenanceResponse>("/admin/maintenance/reap-auth-tokens", {
    method: "POST",
  });
}

export function reapProofOrphans(): Promise<MaintenanceResponse> {
  return apiFetch<MaintenanceResponse>(
    "/admin/maintenance/reap-proof-orphans",
    { method: "POST" }
  );
}

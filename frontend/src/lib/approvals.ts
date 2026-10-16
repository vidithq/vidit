import { apiFetch } from "./api";
import type { components } from "./api-types";
import { changedFields, snapshotToEventView } from "./events";
import { creditedAuthors } from "./geolocatorCredit";
import type { OrganizationRef } from "./organizations";
import type { EventDetail, EventVersion } from "@/types";

export type Approval = components["schemas"]["ApprovalRead"];
export type OrganizationApproval = components["schemas"]["OrganizationApprovalRead"];
type Author = components["schemas"]["AuthorRef"];
type Revoker = NonNullable<Approval["revoked_as"]>;

/** Mirrors `schemas/approval.APPROVAL_NOTE_MAX_LENGTH`; change both. */
export const APPROVAL_NOTE_MAX_LEN = 280;

/** The reviews of one version of an event; the live version when `versionNo` is omitted. */
export function approvalsPath(eventId: string, versionNo?: number): string {
  const base = `/events/${eventId}/approvals`;
  return versionNo === undefined ? base : `${base}?version_no=${versionNo}`;
}

/** The approvals placed in an organization's name, newest first (cursor-paged). */
export function organizationApprovalsPath(slug: string, cursor: string | null): string {
  const base = `/organizations/${encodeURIComponent(slug)}/approvals`;
  return cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
}

// Keyed by the generated revoker values, so a value the backend adds fails the type-check.
const REVOKED_BY: Record<Revoker, string> = {
  reviewer: "Revoked",
  organization_admin: "Revoked by an org-admin",
  site_admin: "Revoked by a site admin",
};

/** The public line's lead for a revoked approval: who revoked it, by role, never by name. */
export function revokedByLabel(approval: Approval): string {
  return approval.revoked_as ? REVOKED_BY[approval.revoked_as] : "Revoked";
}

/** One analyst's own reviews of an event across its versions, oldest version first. */
export function reviewerApprovalsPath(eventId: string, username: string): string {
  return `/events/${eventId}/approvals?reviewer=${encodeURIComponent(username)}`;
}

/** The latest version below `liveVersion` that one of `rows` still stands on, or null.
 *  Mirrors backend notifications.reapproval_offers (approved_version); change both. */
export function standingApprovalBefore(rows: Approval[], liveVersion: number): number | null {
  const versions = rows
    .filter((a) => !a.revoked_at && a.version_no < liveVersion)
    .map((a) => a.version_no);
  return versions.length > 0 ? Math.max(...versions) : null;
}

/** The versioned fields that differ between the filed version a reviewer approved and the live
 *  event, through the version pages' own `changedFields`. Null for a redacted version, whose
 *  content can no longer be compared. */
export function changesSince(current: EventDetail, approved: EventVersion): string[] | null {
  if (approved.redacted) return null;
  return changedFields(current, snapshotToEventView(current, approved));
}

/** The label of an approve button: the version, and the organization it approves for. */
export function approveLabel(versionNo: number, organization?: OrganizationRef | null): string {
  return organization
    ? `Approve version ${versionNo} as ${organization.name}`
    : `Approve version ${versionNo}`;
}

/** Approve `versionNo`, the version the reader has on screen, as the reader or, as its
 *  org-admin, for the organization `organization` (a slug); the backend answers 409 when the
 *  live version moved on since. */
export function approveEvent(
  eventId: string,
  versionNo: number,
  note?: string,
  organization?: string,
): Promise<Approval> {
  return apiFetch<Approval>(approvalsPath(eventId), {
    method: "POST",
    body: JSON.stringify({
      version_no: versionNo,
      note: note?.trim() || null,
      ...(organization ? { organization } : {}),
    }),
  });
}

export function revokeApproval(
  eventId: string,
  approvalId: string,
  reason: string,
): Promise<Approval> {
  return apiFetch<Approval>(`${approvalsPath(eventId)}/${approvalId}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** Whether `userId` may approve the live version of `event`, given its reviews: as themselves,
 *  or, with `organization` (a slug of an organization they administer), in its name.
 *  Mirrors backend services/approvals.approve (published only, never a geolocator, one review
 *  per analyst and version, one standing approval per organization and version); change both. */
export function canApprove(
  event: { status: string; owner: Author; geolocators: Author[] },
  userId: string | undefined,
  liveApprovals: Approval[],
  organization?: string,
): boolean {
  if (!userId || event.status !== "geolocated") return false;
  if (creditedAuthors(event).some((a) => a.id === userId)) return false;
  if (organization) {
    return !liveApprovals.some((a) => a.organization?.slug === organization && !a.revoked_at);
  }
  return !liveApprovals.some((a) => !a.organization && a.reviewer.id === userId);
}

import { apiFetch } from "./api";
import type { components } from "./api-types";
import { changedFields, snapshotToEventView } from "./events";
import { creditedAuthors } from "./geolocatorCredit";
import type { OrganizationRef } from "./organizations";
import type { EventDetail, EventVersion } from "@/types";

export type Approval = components["schemas"]["ApprovalRead"];
export type ApprovalList = components["schemas"]["ApprovalList"];
export type OrganizationApproval = components["schemas"]["OrganizationApprovalRead"];
type Author = components["schemas"]["AuthorRef"];
type Revoker = NonNullable<Approval["revoked_as"]>;

/** The reviews of one version of an event; the live version when `versionNo` is omitted. */
export function approvalsPath(eventId: string, versionNo?: number): string {
  const base = `/events/${eventId}/approvals`;
  return versionNo === undefined ? base : `${base}?version_no=${versionNo}`;
}

/** The reviews of every version of an event, by version then oldest first. */
export function allApprovalsPath(eventId: string): string {
  return `${approvalsPath(eventId)}?all_versions=true`;
}

/** The approvals placed in an organization's name, newest first (cursor-paged). */
export function organizationApprovalsPath(slug: string, cursor: string | null): string {
  const base = `/organizations/${encodeURIComponent(slug)}/approvals`;
  return cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
}

// Keyed by the generated revoker values, so a value the backend adds fails the type-check.
const REVOKED_BY: Record<Revoker, string> = {
  reviewer: "Revoked",
  organization_manager: "Revoked by an org manager",
  site_admin: "Revoked by a site admin",
};

/** The public line's lead for a revoked approval: who revoked it, by role, never by name. */
export function revokedByLabel(approval: Approval): string {
  return approval.revoked_as ? REVOKED_BY[approval.revoked_as] : "Revoked";
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

/** Approve `versionNo`, the version the reader has on screen, as the reader or, as its
 *  org manager, for the organization `organization` (a slug); the backend answers 409 when the
 *  live version moved on since. */
export function approveEvent(
  eventId: string,
  versionNo: number,
  organization?: string,
): Promise<Approval> {
  return apiFetch<Approval>(approvalsPath(eventId), {
    method: "POST",
    body: JSON.stringify({ version_no: versionNo, ...(organization ? { organization } : {}) }),
  });
}

/** The reader's own review of the live version, standing or revoked; null when there is none.
 *  An analyst reviews a version once, revoked included, so there is at most one. Mirrors backend
 *  services/approvals.approve; change both. */
export function ownApprovalOnLive(
  rows: Approval[],
  liveVersion: number,
  userId: string | undefined,
): Approval | null {
  if (!userId) return null;
  return (
    rows.find(
      (a) => !a.organization && a.reviewer?.id === userId && a.version_no === liveVersion,
    ) ?? null
  );
}

export function revokeApproval(eventId: string, approvalId: string): Promise<Approval> {
  return apiFetch<Approval>(`${approvalsPath(eventId)}/${approvalId}/revoke`, {
    method: "POST",
  });
}

/** Why the reader cannot approve the live version again after their approval of it was
 *  revoked. */
export function cannotApproveAgainLine(approval: Approval): string {
  const lead =
    approval.revoked_as === "reviewer"
      ? `You revoked your approval of version ${approval.version_no}.`
      : `Your approval of version ${approval.version_no} was revoked.`;
  return `${lead} You cannot approve this version again.`;
}

/** The confirmation an approval shows once it is placed. */
export function approvedNotice(approval: Approval): string {
  return approval.organization
    ? `Approved version ${approval.version_no} as ${approval.organization.name}.`
    : `Approved version ${approval.version_no}.`;
}

export const REVOKED_NOTICE = "Approval revoked.";

/** Whether `userId` may approve the live version of `event`, given its reviews: as themselves,
 *  or, with `organization` (a slug of an organization they manage), in its name.
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
  return !liveApprovals.some((a) => !a.organization && a.reviewer?.id === userId);
}

/** What the reader may approve on the live version: as themselves (`eligible`), and for which of
 *  the organizations they manage. Nothing when the server says the reader cannot approve, since
 *  it knows departed geolocators the event's credit no longer lists. */
export function approveOptions(
  event: { status: string; version_no: number; owner: Author; geolocators: Author[] },
  approvals: ApprovalList,
  managed: OrganizationRef[],
  userId: string | undefined,
): { eligible: boolean; organizations: OrganizationRef[] } {
  if (!approvals.viewer_can_approve) return { eligible: false, organizations: [] };
  const live = approvals.items.filter((a) => a.version_no === event.version_no);
  return {
    eligible: canApprove(event, userId, live),
    organizations: managed.filter((o) => canApprove(event, userId, live, o.slug)),
  };
}

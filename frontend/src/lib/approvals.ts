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
  organization_member: "Revoked by a member of the organization",
  site_admin: "Revoked by a site admin",
};

/** The public line's lead for a revoked approval: who revoked it, by role, never by name. */
export function revokedByLabel(approval: Approval): string {
  return approval.revoked_as ? REVOKED_BY[approval.revoked_as] : "Revoked";
}

/** The latest version below `liveVersion` that one of `rows` still stands on, or null. */
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

/** Approve `versionNo`, the version the reader has on screen, as the reader or, as one of its
 *  members, for the organization `organization` (a slug); the backend answers 409 when the
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

/** Whether `approval` closes its version to another review by the same analyst, or for the same
 *  organization: it stands, or someone other than its own side revoked it. A site admin's
 *  revocation closes an organization's version; an analyst's own revocation reopens theirs. The
 *  revocation stamped when the reviewer joined the geolocators also closes it, which the credit
 *  check covers here. Mirrors backend services/approvals.closes_review; change both. */
export function closesReview(approval: Approval): boolean {
  if (!approval.revoked_at) return true;
  return approval.organization
    ? approval.revoked_as === "site_admin"
    : approval.revoked_as !== "reviewer";
}

function ownOnLive(rows: Approval[], liveVersion: number, userId: string | undefined): Approval[] {
  if (!userId) return [];
  return rows.filter(
    (a) => !a.organization && a.reviewer?.id === userId && a.version_no === liveVersion,
  );
}

/** The standing approval `organization` (a slug) gave the live version, or null: any of its
 *  members revokes it. Mirrors backend services/approvals._revoker_role; change both. */
export function organizationApprovalOnLive(
  rows: Approval[],
  liveVersion: number,
  organization: string,
): Approval | null {
  return (
    rows.find(
      (a) =>
        a.organization?.slug === organization && a.version_no === liveVersion && !a.revoked_at,
    ) ?? null
  );
}

/** The reader's own standing approval of the live version, or null. */
export function ownApprovalOnLive(
  rows: Approval[],
  liveVersion: number,
  userId: string | undefined,
): Approval | null {
  return ownOnLive(rows, liveVersion, userId).find((a) => !a.revoked_at) ?? null;
}

/** The revocation of the reader's own approval of the live version that bars them from
 *  approving it again, or null: a site admin's. */
export function blockingRevocation(
  rows: Approval[],
  liveVersion: number,
  userId: string | undefined,
): Approval | null {
  return ownOnLive(rows, liveVersion, userId).find((a) => a.revoked_at && closesReview(a)) ?? null;
}

export function revokeApproval(eventId: string, approvalId: string): Promise<Approval> {
  return apiFetch<Approval>(`${approvalsPath(eventId)}/${approvalId}/revoke`, {
    method: "POST",
  });
}

/** Why the reader cannot approve the live version again after someone else revoked their
 *  approval of it. */
export function cannotApproveAgainLine(approval: Approval): string {
  return `Your approval of version ${approval.version_no} was revoked. You cannot approve this version again.`;
}

/** Whether `userId` may approve the live version of `event`, given its reviews: as themselves,
 *  or, with `organization` (a slug of an organization they are a member of), in its name.
 *  Mirrors backend services/approvals.approve (published only, never a geolocator, no review of
 *  the version that `closesReview`); change both. */
export function canApprove(
  event: { status: string; owner: Author; geolocators: Author[] },
  userId: string | undefined,
  liveApprovals: Approval[],
  organization?: string,
): boolean {
  if (!userId || event.status !== "geolocated") return false;
  if (creditedAuthors(event).some((a) => a.id === userId)) return false;
  if (organization) {
    return !liveApprovals.some((a) => a.organization?.slug === organization && closesReview(a));
  }
  return !liveApprovals.some(
    (a) => !a.organization && a.reviewer?.id === userId && closesReview(a),
  );
}

/** What the reader may approve on the live version: as themselves (`eligible`), and for which of
 *  the organizations they are a member of. Nothing when the server says the reader cannot
 *  approve, since it knows departed geolocators the event's credit no longer lists. */
export function approveOptions(
  event: { status: string; version_no: number; owner: Author; geolocators: Author[] },
  approvals: ApprovalList,
  memberOf: OrganizationRef[],
  userId: string | undefined,
): { eligible: boolean; organizations: OrganizationRef[] } {
  if (!approvals.viewer_can_approve) return { eligible: false, organizations: [] };
  const live = approvals.items.filter((a) => a.version_no === event.version_no);
  return {
    eligible: canApprove(event, userId, live),
    organizations: memberOf.filter((o) => canApprove(event, userId, live, o.slug)),
  };
}

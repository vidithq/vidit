import { apiFetch } from "./api";
import type { components } from "./api-types";
import { changedFields, snapshotToEventView } from "./events";
import { creditedAuthors } from "./geolocatorCredit";
import type { OrganizationRef } from "./organizations";
import type { AuthorRef as Author, EventDetail, EventVersion } from "@/types";
import { withCursor } from "./pagination";

export type Approval = components["schemas"]["ApprovalRead"];
export type ApprovalList = components["schemas"]["ApprovalList"];
export type OrganizationApproval = components["schemas"]["OrganizationApprovalRead"];

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
  return withCursor(`/organizations/${encodeURIComponent(slug)}/approvals`, cursor);
}

/** The latest version below `liveVersion` that one of `rows` approved, or null. */
export function approvalBefore(rows: Approval[], liveVersion: number): number | null {
  const versions = rows.filter((a) => a.version_no < liveVersion).map((a) => a.version_no);
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

/** Delete one approval as a site admin (`DELETE /admin/approvals/{id}`); its reviewer or
 *  organization can approve that version again. */
export function deleteApproval(approvalId: string): Promise<void> {
  return apiFetch<void>(`/admin/approvals/${approvalId}`, { method: "DELETE" });
}

/** Whether `userId` may approve the live version of `event`, given its approvals: as themselves,
 *  or, with `organization` (a slug of an organization they are a member of), in its name.
 *  Mirrors backend services/approvals.approve (published only, never a geolocator, one approval
 *  per reviewer or organization and version); change both. */
export function canApprove(
  event: { status: string; owner: Author; geolocators: Author[] },
  userId: string | undefined,
  liveApprovals: Approval[],
  organization?: string,
): boolean {
  if (!userId || event.status !== "geolocated") return false;
  if (creditedAuthors(event).some((a) => a.id === userId)) return false;
  if (organization) {
    return !liveApprovals.some((a) => a.organization?.slug === organization);
  }
  return !liveApprovals.some((a) => !a.organization && a.reviewer?.id === userId);
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

import { apiFetch } from "./api";
import type { components } from "./api-types";
import { changedFields, snapshotToEventView } from "./events";
import { creditedAuthors } from "./geolocatorCredit";
import type { EventDetail, EventVersion } from "@/types";

export type Approval = components["schemas"]["ApprovalRead"];
type Author = components["schemas"]["AuthorRef"];

/** Mirrors `schemas/approval.APPROVAL_NOTE_MAX_LENGTH`; change both. */
export const APPROVAL_NOTE_MAX_LEN = 280;

/** The reviews of one version of an event; the live version when `versionNo` is omitted. */
export function approvalsPath(eventId: string, versionNo?: number): string {
  const base = `/events/${eventId}/approvals`;
  return versionNo === undefined ? base : `${base}?version_no=${versionNo}`;
}

/** One analyst's reviews of an event across its versions, oldest version first. */
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

/** Approve `versionNo`, the version the reader has on screen; the backend answers 409 when the
 *  live version moved on since. */
export function approveEvent(
  eventId: string,
  versionNo: number,
  note?: string,
): Promise<Approval> {
  return apiFetch<Approval>(approvalsPath(eventId), {
    method: "POST",
    body: JSON.stringify({ version_no: versionNo, note: note?.trim() || null }),
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

/** Whether `userId` may approve the live version of `event`, given its reviews.
 *  Mirrors backend services/approvals.approve (published only, never a geolocator, one review
 *  per analyst and version); change both. */
export function canApprove(
  event: { status: string; owner: Author; geolocators: Author[] },
  userId: string | undefined,
  liveApprovals: Approval[],
): boolean {
  if (!userId || event.status !== "geolocated") return false;
  if (creditedAuthors(event).some((a) => a.id === userId)) return false;
  return !liveApprovals.some((a) => a.reviewer.id === userId);
}

import { apiFetch } from "./api";
import type { components } from "./api-types";
import { creditedAuthors } from "./geolocatorCredit";
import type { AuthorRef as Author } from "@/types";

export type ApprovalRequest = components["schemas"]["ApprovalRequestRead"];
export type ApprovalRequestTargets = components["schemas"]["ApprovalRequestTargetList"];
export type OrganizationApprovalRequest = components["schemas"]["OrganizationApprovalRequestRead"];
export type ApprovalRequestAudience =
  components["schemas"]["UserPreferencesRead"]["approval_request_audience"];

/** Whom an approval request asks: an analyst by username, or an organization by slug. */
export type ApprovalRequestTarget = { username: string } | { organization: string };

/** The audience of an analyst or organization that never chose one.
 *  Mirrors backend `user_preferences.APPROVAL_REQUEST_AUDIENCE_DEFAULT`; change both. */
export const APPROVAL_REQUEST_AUDIENCE_DEFAULT: ApprovalRequestAudience = "following";

// Keyed by the generated audience values, so a value the backend adds fails the type-check.
const AUDIENCE_LABELS: Record<ApprovalRequestAudience, string> = {
  following: "People I follow",
  everyone: "Everyone",
  nobody: "Nobody",
};

function audienceOptions(labels: Record<ApprovalRequestAudience, string>) {
  return (Object.keys(labels) as ApprovalRequestAudience[]).map((value) => ({
    value,
    label: labels[value],
  }));
}

/** The Settings choices for who may send the reader an approval request. */
export const APPROVAL_REQUEST_AUDIENCE_OPTIONS = audienceOptions(AUDIENCE_LABELS);

/** The organization page's choices for who may send the organization an approval request.
 *  `following` admits an analyst any org manager follows. */
export const ORGANIZATION_AUDIENCE_OPTIONS = audienceOptions({
  ...AUDIENCE_LABELS,
  following: "People our org managers follow",
});

/** Open requests on an event: every one for its geolocators, the reader's own otherwise. */
export function approvalRequestsPath(eventId: string): string {
  return `/events/${eventId}/approval-requests`;
}

/** The analysts and organizations the reader can ask to approve the event now, narrowed by a
 *  substring of the username, or of the organization's name or slug. */
export function approvalRequestTargetsPath(eventId: string, query: string): string {
  return `/events/${eventId}/approval-request-targets?q=${encodeURIComponent(query)}`;
}

/** The open requests addressed to an organization (its org managers and site admins). */
export function organizationApprovalRequestsPath(slug: string): string {
  return `/organizations/${encodeURIComponent(slug)}/approval-requests`;
}

export function requestApproval(
  eventId: string,
  target: ApprovalRequestTarget,
): Promise<ApprovalRequest> {
  return apiFetch<ApprovalRequest>(approvalRequestsPath(eventId), {
    method: "POST",
    body: JSON.stringify(target),
  });
}

export function declineApprovalRequest(eventId: string, requestId: string): Promise<ApprovalRequest> {
  return apiFetch<ApprovalRequest>(`${approvalRequestsPath(eventId)}/${requestId}/decline`, {
    method: "POST",
  });
}

/** Whether `userId` may ask for approval of `event`: a published event they are credited on.
 *  Mirrors backend services/approval_requests._require_requester; change both. */
export function canRequestApproval(
  event: { status: string; owner: Author; geolocators: Author[] },
  userId: string | undefined,
): boolean {
  if (!userId || event.status !== "geolocated") return false;
  return creditedAuthors(event).some((a) => a.id === userId);
}

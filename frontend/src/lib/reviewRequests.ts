import { apiFetch } from "./api";
import type { components } from "./api-types";
import { creditedAuthors } from "./geolocatorCredit";

export type ReviewRequest = components["schemas"]["ReviewRequestRead"];
export type ReviewRequestTargets = components["schemas"]["ReviewRequestTargetList"];
export type OrganizationReviewRequest = components["schemas"]["OrganizationReviewRequestRead"];
export type ReviewRequestAudience =
  components["schemas"]["UserPreferencesRead"]["review_request_audience"];
type Author = components["schemas"]["AuthorRef"];

/** Whom a review request asks: an analyst by username, or an organization by slug. */
export type ReviewRequestTarget = { username: string } | { organization: string };

// Keyed by the generated audience values, so a value the backend adds fails the type-check.
const AUDIENCE_LABELS: Record<ReviewRequestAudience, string> = {
  following: "People I follow",
  everyone: "Everyone",
  nobody: "Nobody",
};

function audienceOptions(labels: Record<ReviewRequestAudience, string>) {
  return (Object.keys(labels) as ReviewRequestAudience[]).map((value) => ({
    value,
    label: labels[value],
  }));
}

/** The Settings choices for who may send the reader a review request. */
export const REVIEW_REQUEST_AUDIENCE_OPTIONS = audienceOptions(AUDIENCE_LABELS);

/** The organization page's choices for who may send the organization a review request.
 *  `following` admits an analyst any org-admin follows. */
export const ORGANIZATION_AUDIENCE_OPTIONS = audienceOptions({
  ...AUDIENCE_LABELS,
  following: "People our org-admins follow",
});

/** Open requests on an event: every one for its geolocators, the reader's own otherwise. */
export function reviewRequestsPath(eventId: string): string {
  return `/events/${eventId}/review-requests`;
}

/** The analysts and organizations the reader can ask to review the event now, narrowed by a
 *  substring of the username, or of the organization's name or slug. */
export function reviewRequestTargetsPath(eventId: string, query: string): string {
  return `/events/${eventId}/review-request-targets?q=${encodeURIComponent(query)}`;
}

/** The open requests addressed to an organization (its org-admins and site admins). */
export function organizationReviewRequestsPath(slug: string): string {
  return `/organizations/${encodeURIComponent(slug)}/review-requests`;
}

export function requestReview(
  eventId: string,
  target: ReviewRequestTarget,
): Promise<ReviewRequest> {
  return apiFetch<ReviewRequest>(reviewRequestsPath(eventId), {
    method: "POST",
    body: JSON.stringify(target),
  });
}

export function declineReviewRequest(eventId: string, requestId: string): Promise<ReviewRequest> {
  return apiFetch<ReviewRequest>(`${reviewRequestsPath(eventId)}/${requestId}/decline`, {
    method: "POST",
  });
}

/** Whether `userId` may ask for a review of `event`: a published event they are credited on.
 *  Mirrors backend services/review_requests._require_requester; change both. */
export function canRequestReview(
  event: { status: string; owner: Author; geolocators: Author[] },
  userId: string | undefined,
): boolean {
  if (!userId || event.status !== "geolocated") return false;
  return creditedAuthors(event).some((a) => a.id === userId);
}

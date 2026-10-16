import { apiFetch } from "./api";
import type { components } from "./api-types";
import { creditedAuthors } from "./geolocatorCredit";

export type ReviewRequest = components["schemas"]["ReviewRequestRead"];
export type ReviewRequestAudience =
  components["schemas"]["UserPreferencesRead"]["review_request_audience"];
type Author = components["schemas"]["AuthorRef"];

// Keyed by the generated audience values, so a value the backend adds fails the type-check.
const AUDIENCE_LABELS: Record<ReviewRequestAudience, string> = {
  following: "People I follow",
  everyone: "Everyone",
  nobody: "Nobody",
};

/** The Settings choices for who may send the reader a review request. */
export const REVIEW_REQUEST_AUDIENCE_OPTIONS = (
  Object.keys(AUDIENCE_LABELS) as ReviewRequestAudience[]
).map((value) => ({ value, label: AUDIENCE_LABELS[value] }));

/** Open requests on an event: every one for its geolocators, the reader's own otherwise. */
export function reviewRequestsPath(eventId: string): string {
  return `/events/${eventId}/review-requests`;
}

/** The analysts the reader can ask to review the event now, narrowed by a username substring. */
export function reviewRequestTargetsPath(eventId: string, query: string): string {
  return `/events/${eventId}/review-request-targets?q=${encodeURIComponent(query)}`;
}

export function requestReview(eventId: string, username: string): Promise<ReviewRequest> {
  return apiFetch<ReviewRequest>(reviewRequestsPath(eventId), {
    method: "POST",
    body: JSON.stringify({ username }),
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

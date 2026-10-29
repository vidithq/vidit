import { apiFetch } from "./api";
import type { components } from "./api-types";
import type { AuthorRef as Author } from "@/types";

export type GeolocatorInvite = components["schemas"]["GeolocatorInviteRead"];

/** Geolocators plus pending invitations on one event, the owner included. Mirrors
 *  `geolocator_credit.MAX_EVENT_GEOLOCATORS`; change both. */
export const MAX_EVENT_GEOLOCATORS = 10;

/** What the invite picker prints once the credit line is full. */
export const GEOLOCATOR_CAP_MESSAGE = `An event credits at most ${MAX_EVENT_GEOLOCATORS} geolocators, you and pending invitations included.`;

/** The analysts an event credits, owner first, then every other geolocator by credit time. The
 *  owner of a published row is a geolocator too; a request or a detection has none, so its
 *  owner stands alone. */
export function creditedAuthors(event: {
  owner: Author;
  geolocators: Author[];
}): Author[] {
  return [event.owner, ...event.geolocators.filter((g) => g.id !== event.owner.id)];
}

/** The credit line as `AuthorByline` and `<Item>` take it: the lead name and the rest. */
export function creditProps(event: { owner: Author; geolocators: Author[] }): {
  author: Author;
  coAuthors: Author[];
} {
  const [author, ...coAuthors] = creditedAuthors(event);
  return { author, coAuthors };
}

/** Pending invitations on an event: every one for its owner, the reader's own otherwise. */
export function geolocatorInvitesPath(eventId: string): string {
  return `/events/${eventId}/geolocator-invites`;
}

export function inviteGeolocator(eventId: string, username: string): Promise<GeolocatorInvite> {
  return apiFetch<GeolocatorInvite>(geolocatorInvitesPath(eventId), {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export function withdrawGeolocatorInvite(eventId: string, username: string): Promise<void> {
  return apiFetch<void>(
    `${geolocatorInvitesPath(eventId)}/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

export type InviteAnswer = "accept" | "decline";

/** The invitee's answer to their own invitation. */
export function answerGeolocatorInvite(
  eventId: string,
  answer: InviteAnswer,
): Promise<void> {
  return apiFetch<void>(`${geolocatorInvitesPath(eventId)}/${answer}`, { method: "POST" });
}

/** The owner removes a co-geolocator, or a co-geolocator removes themselves. */
export function removeGeolocator(eventId: string, username: string): Promise<void> {
  return apiFetch<void>(
    `/events/${eventId}/geolocators/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

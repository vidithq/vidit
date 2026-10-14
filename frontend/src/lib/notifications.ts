import { apiFetch } from "./api";
import type { components } from "./api-types";

export type Notification = components["schemas"]["NotificationRead"];
export type NotificationKind = Notification["kind"];
export type UnreadCount = components["schemas"]["NotificationUnreadCount"];

export const NOTIFICATIONS_PATH = "/notifications";
export const UNREAD_COUNT_PATH = "/notifications/unread-count";

export function notificationsPath(cursor: string | null): string {
  return cursor
    ? `${NOTIFICATIONS_PATH}?cursor=${encodeURIComponent(cursor)}`
    : NOTIFICATIONS_PATH;
}

/** Advance the last-read marker to the newest row the reader was shown. */
export function markNotificationsRead(upTo: string): Promise<void> {
  return apiFetch<void>(`${NOTIFICATIONS_PATH}/read`, {
    method: "POST",
    body: JSON.stringify({ up_to: upTo }),
  });
}

/** Per-kind copy for the feed and the settings rows. Keyed by the generated kind, so a kind
 *  the backend registers fails the type-check until it gets its wording here. */
export const NOTIFICATION_KIND_COPY: Record<
  NotificationKind,
  { label: string; setting: string }
> = {
  request_fulfilled: {
    label: "Request fulfilled",
    setting: "Someone geolocates a request you opened.",
  },
  new_follower: {
    label: "New follower",
    setting: "Someone follows you.",
  },
};

/** The feed row's sentence and destination. */
export function describeNotification(n: Notification): { text: string; href: string } {
  const actor = n.actor?.username ?? "Someone";
  switch (n.kind) {
    case "request_fulfilled":
      return {
        text: `${actor} geolocated your request: ${n.event?.title ?? ""}`,
        href: n.event ? `/events/${n.event.id}` : "/requests",
      };
    case "new_follower":
      return {
        text: `${actor} followed you`,
        href: n.actor ? `/profile/${n.actor.username}` : "/notifications",
      };
  }
}

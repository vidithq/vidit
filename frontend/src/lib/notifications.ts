import { apiFetch } from "./api";
import type { components } from "./api-types";
import { organizationPath } from "./organizations";

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

/** Mark the rows the feed displayed read (one page of ids at most, as the backend caps it). */
export function markNotificationsRead(ids: string[]): Promise<void> {
  return apiFetch<void>(`${NOTIFICATIONS_PATH}/read`, {
    method: "POST",
    body: JSON.stringify({ ids }),
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
  x_handle_request_approved: {
    label: "X handle change approved",
    setting: "An admin links the X handle you requested to your account.",
  },
  x_handle_request_declined: {
    label: "X handle change declined",
    setting: "An admin declines the X handle you requested.",
  },
  co_geolocator_invite: {
    label: "Geolocator invitation",
    setting: "Someone invites you to share the credit of their geolocation.",
  },
  co_geolocator_removed: {
    label: "Credit removed",
    setting: "The owner of a geolocation removes you from its geolocators.",
  },
  ownership_transferred: {
    label: "Ownership transferred",
    setting: "A geolocation you share passes to you because its owner's account was removed.",
  },
  organization_invite: {
    label: "Organization invite",
    setting: "An org-admin invites you to join an organization.",
  },
  organization_invite_accepted: {
    label: "Invite accepted",
    setting: "Someone accepts your invite to an organization.",
  },
  organization_admin_inherited: {
    label: "Now org-admin",
    setting: "You become an org-admin because the last one left Vidit.",
  },
  re_approve_requested: {
    label: "New version to approve",
    setting: "A geolocation you, or an organization you administer, approved gets a new version.",
  },
  approval_received: {
    label: "Approval received",
    setting: "Someone approves your geolocation, as themselves or for an organization.",
  },
  review_request_received: {
    label: "Review request",
    setting: "Someone asks you, or an organization you administer, to review their geolocation.",
  },
  review_request_declined: {
    label: "Review request declined",
    setting: "An analyst or an organization you asked declines to review your geolocation.",
  },
};

/** The feed row's sentence and destination. */
export function describeNotification(n: Notification): { text: string; href: string } {
  const actor = n.actor?.username ?? "Someone";
  const title = n.event?.title ?? "";
  const eventHref = n.event ? `/events/${n.event.id}` : "/notifications";
  const organization = n.organization?.name ?? "an organization";
  switch (n.kind) {
    case "request_fulfilled":
      return {
        text: `${actor} geolocated your request: ${title}`,
        href: n.event ? `/events/${n.event.id}` : "/requests",
      };
    case "new_follower":
      return {
        text: `${actor} followed you`,
        href: n.actor ? `/profile/${n.actor.username}` : "/notifications",
      };
    case "x_handle_request_approved":
      return { text: "An admin linked the X handle you requested", href: "/settings" };
    case "x_handle_request_declined":
      return {
        text: "An admin declined your X handle request. Settings shows why.",
        href: "/settings",
      };
    case "co_geolocator_invite":
      return {
        text: `${actor} invited you to share the credit of: ${title}`,
        href: eventHref,
      };
    case "co_geolocator_removed":
      return {
        text: `${actor} removed you from the geolocators of: ${title}`,
        href: eventHref,
      };
    case "ownership_transferred":
      return {
        text: `You now own: ${title}. Its previous owner's account was removed.`,
        href: eventHref,
      };
    case "organization_invite":
      return {
        text: `${actor} invited you to join ${organization}`,
        href: n.organization ? organizationPath(n.organization.slug) : "/notifications",
      };
    case "organization_invite_accepted":
      return {
        text: `${actor} joined ${organization}`,
        href: n.organization ? organizationPath(n.organization.slug) : "/notifications",
      };
    case "organization_admin_inherited":
      return {
        text: `You are now an org-admin of ${organization}`,
        href: n.organization ? organizationPath(n.organization.slug) : "/notifications",
      };
    // The four kinds below name an organization when the approval or the request is one.
    case "re_approve_requested":
      return {
        text: `${actor} saved a new version of a geolocation ${n.organization ? organization : "you"} approved: ${title}`,
        href: eventHref,
      };
    case "approval_received":
      return {
        text: `${actor} approved your geolocation${n.organization ? ` for ${organization}` : ""}: ${title}`,
        href: eventHref,
      };
    case "review_request_received":
      return {
        text: `${actor} asked ${n.organization ? organization : "you"} to review: ${title}`,
        href: eventHref,
      };
    case "review_request_declined":
      return {
        text: `${actor} declined${n.organization ? ` for ${organization}` : ""} to review: ${title}`,
        href: eventHref,
      };
  }
}

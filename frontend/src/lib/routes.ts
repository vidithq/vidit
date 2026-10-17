/** Page routes built from an id or a username, so a route's shape lives in one place. API paths
 *  that share a shape (`/events/{id}`) keep their own builders. */

export function eventHref(id: string): string {
  return `/events/${encodeURIComponent(id)}`;
}

export function profileHref(username: string): string {
  return `/profile/${encodeURIComponent(username)}`;
}

/** The analyst's own detections queue. */
export function detectionsQueueHref(username: string): string {
  return `${profileHref(username)}/detections`;
}

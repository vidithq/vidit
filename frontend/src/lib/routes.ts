export function eventHref(id: string): string {
  return `/events/${encodeURIComponent(id)}`;
}

export function profileHref(username: string): string {
  return `/profile/${encodeURIComponent(username)}`;
}

export function detectionsQueueHref(username: string): string {
  return `${profileHref(username)}/detections`;
}

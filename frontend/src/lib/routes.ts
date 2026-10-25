export function eventHref(id: string): string {
  return `/events/${encodeURIComponent(id)}`;
}

/** A request's page: a `requested` row reads at `/requests/{id}`, not `/events/{id}`. */
export function requestHref(id: string): string {
  return `/requests/${encodeURIComponent(id)}`;
}

/** Marks an edit URL as a step of a review pass; every hop carries it so the walk survives a
 *  reload and Back. */
export const QUEUE_PARAM = "queue";

/** The edit form of an event, a request or a detection; `inQueue` makes it a review pass step. */
export function eventEditHref(id: string, inQueue = false): string {
  return `${eventHref(id)}/edit${inQueue ? `?${QUEUE_PARAM}=1` : ""}`;
}

export function profileHref(username: string): string {
  return `/profile/${encodeURIComponent(username)}`;
}

export function detectionsQueueHref(username: string): string {
  return `${profileHref(username)}/detections`;
}

/** The `/submit` entry paths, each kept in the `mode` query so a reload or Back returns to it. */
export type SubmitMode = "single" | "xpost" | "bulk";

/** One entry path of `/submit`; without a mode, the chooser. */
export function submitHref(mode?: SubmitMode): string {
  return mode ? `/submit?mode=${mode}` : "/submit";
}

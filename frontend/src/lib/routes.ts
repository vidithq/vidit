export function eventHref(id: string): string {
  return `/events/${encodeURIComponent(id)}`;
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

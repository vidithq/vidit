import { ApiError, apiFetch } from "./api";
import type { components } from "./api-types";
import { cleanNumber } from "./coordinates";
import { MAX_LINKS_PER_SOURCE, type SourceFloorState } from "./events";
import { toDatetimeLocalUTC } from "./format";
import type { ArchivedLink, Media } from "@/types";

/** One source of an event, in the event's derived order (level, then capture time). */
export type Source = components["schemas"]["SourceRead"];
export type SourceLink = components["schemas"]["SourceLinkRead"];
/** A source the picker found (`GET /sources`), with the event that holds it. */
export type SourcePick = components["schemas"]["SourcePickRead"];
/** A staged source file (`POST /uploads`), referenced by a source's `upload_id`. */
export type Upload = components["schemas"]["UploadRead"];
export type SourceLevel = Source["level"];
export type Sensor = NonNullable<Source["sensor"]>;

/** Keyed by the generated union, so a level the backend adds fails the type-check. */
export const LEVEL_LABELS: Record<SourceLevel, string> = {
  direct: "Direct",
  indirect: "Indirect",
  context: "Context",
};

/** In the order the API serves sources. */
export const SOURCE_LEVELS = Object.keys(LEVEL_LABELS) as SourceLevel[];

/** Keyed by the generated union, so a sensor the backend adds fails the type-check. */
export const SENSOR_LABELS: Record<Sensor, string> = {
  smartphone: "Smartphone",
  satellite: "Satellite",
  drone: "Drone",
  static_camera: "Static camera",
  dashcam: "Dashcam",
  body_cam: "Body / helmet cam",
  unknown: "Unknown",
};

export const SENSORS = Object.keys(SENSOR_LABELS) as Sensor[];

/** The first URL of an event's sources, for the one-host labels of a row or card. */
export function firstSourceUrl(event: { sources: Pick<Source, "links">[] }): string | null {
  return event.sources.flatMap((s) => s.links)[0]?.url ?? null;
}

/** The sensor a reading surface names: none for `unknown`, which tells the reader nothing. */
export function shownSensor(sensor: Source["sensor"]): Sensor | null {
  return sensor && sensor !== "unknown" ? sensor : null;
}

/** One entry of an event write's `sources` JSON field. Mirrors `schemas/source.SourceCreate`;
 *  change both. */
export interface SourceCreate {
  id?: string;
  title: string;
  level: SourceLevel;
  sensor: Sensor | null;
  captured_at: string | null;
  camera_position: { lat: number; lng: number } | null;
  is_graphic: boolean;
  links: { url: string; posted_at: string | null; snapshot_url: string | null }[];
  tag_ids: string[];
  upload_id?: string;
  media_id?: string;
}

/** A source file in a form. `stored` names a file that already exists (this source's own, or
 *  another source's, which the write copies) and posts `media_id`; `staged` posts `upload_id`. */
export type SourceFile =
  | { state: "stored"; media: Media }
  | { state: "uploading"; file: File; token: number }
  | { state: "staged"; upload: Upload }
  | { state: "failed"; file: File; error: string };

/** One link row as the form holds it: input strings, plus the stored values an untouched input
 *  posts back at full precision. */
export interface LinkDraft {
  url: string;
  /** `datetime-local` value, UTC. */
  postedAt: string;
  /** The archived copy posted back as `snapshot_url`: the stored one until replaced. */
  snapshotUrl: string;
  /** What the link held when the form loaded, or null for a new row. */
  stored: { url: string; postedAt: string | null; archived: ArchivedLink | null } | null;
}

/** One source editor's state. */
export interface SourceDraft {
  /** React key; stable across reorders and merges. */
  key: string;
  /** A stored source of this event, updated in place; null creates one. */
  id: string | null;
  title: string;
  level: SourceLevel;
  /** `""` names no sensor. */
  sensor: Sensor | "";
  /** `datetime-local` value, UTC. */
  capturedAt: string;
  /** The stored instant, posted back when the input still holds its seed. */
  storedCapturedAt: string | null;
  cameraLat: string;
  cameraLng: string;
  isGraphic: boolean;
  /** The stored source is flagged: only an admin clears it. */
  graphicLocked: boolean;
  links: LinkDraft[];
  tagIds: string[];
  file: SourceFile | null;
}

let keyCounter = 0;
const nextKey = () => `source-${++keyCounter}`;

const blankLink = (): LinkDraft => ({ url: "", postedAt: "", snapshotUrl: "", stored: null });

/** The editor a form starts with, and the one **Add a source** appends. */
export function newSourceDraft(): SourceDraft {
  return {
    key: nextKey(),
    id: null,
    title: "",
    level: "direct",
    sensor: "",
    capturedAt: "",
    storedCapturedAt: null,
    cameraLat: "",
    cameraLng: "",
    isGraphic: false,
    graphicLocked: false,
    links: [blankLink()],
    tagIds: [],
    file: null,
  };
}

function linkDraftsOf(links: SourceLink[]): LinkDraft[] {
  return links.map((link) => ({
    url: link.url,
    postedAt: toDatetimeLocalUTC(link.posted_at),
    snapshotUrl: link.archived?.url ?? "",
    stored: { url: link.url, postedAt: link.posted_at, archived: link.archived },
  }));
}

function draftFields(source: Source) {
  return {
    title: source.title,
    level: source.level,
    sensor: source.sensor ?? ("" as const),
    capturedAt: toDatetimeLocalUTC(source.captured_at),
    storedCapturedAt: source.captured_at,
    cameraLat: source.camera_position ? String(source.camera_position.lat) : "",
    cameraLng: source.camera_position ? String(source.camera_position.lng) : "",
    tagIds: source.tags.map((t) => t.id),
  };
}

/** An editor seeded from a stored source of the event the form writes. */
export function sourceDraftFrom(source: Source): SourceDraft {
  return {
    key: nextKey(),
    id: source.id,
    ...draftFields(source),
    isGraphic: source.is_graphic,
    graphicLocked: source.is_graphic,
    links: source.links.length > 0 ? linkDraftsOf(source.links) : [blankLink()],
    file: source.media ? { state: "stored", media: source.media } : null,
  };
}

/** A new editor filled from a source the picker found: its file is copied by the write (its
 *  `media_id`), and the copy takes its graphic flag. */
export function sourceDraftFromPick(pick: SourcePick): SourceDraft {
  return {
    ...sourceDraftFrom(pick),
    key: nextKey(),
    id: null,
    // A copy is a new source: its links are new rows that carry the pick's archived copies.
    links:
      pick.links.length > 0
        ? linkDraftsOf(pick.links).map((link) => ({ ...link, stored: null }))
        : [blankLink()],
    graphicLocked: false,
  };
}

/** Merge `drop` into `keep`: `keep` takes the links of `drop` it does not already hold, up to
 *  `MAX_LINKS_PER_SOURCE`, and the graphic flag when `drop` carries it. The caller removes
 *  `drop`. Returns the merged editor and how many links did not fit. */
export function mergeSourceDrafts(
  keep: SourceDraft,
  drop: SourceDraft,
): { merged: SourceDraft; overflow: number } {
  const urls = new Set(keep.links.map((l) => l.url.trim()).filter(Boolean));
  const kept = keep.links.filter((l) => l.url.trim() !== "");
  const incoming = drop.links.filter((l) => {
    const url = l.url.trim();
    if (!url || urls.has(url)) return false;
    urls.add(url);
    return true;
  });
  const room = Math.max(0, MAX_LINKS_PER_SOURCE - kept.length);
  // A link moved from another source is a new row on this one.
  const moved = incoming.slice(0, room).map((l) => ({ ...l, stored: null }));
  const links = [...kept, ...moved];
  return {
    merged: {
      ...keep,
      links: links.length > 0 ? links : [blankLink()],
      isGraphic: keep.isGraphic || drop.isGraphic,
    },
    overflow: incoming.length - moved.length,
  };
}

/** The draft's file as the write names it, or null for none (an upload still running or a
 *  failed one names none). */
function fileReference(file: SourceFile | null): Pick<SourceCreate, "upload_id" | "media_id"> {
  if (file?.state === "stored") return { media_id: file.media.id };
  if (file?.state === "staged") return { upload_id: file.upload.id };
  return {};
}

/** A file that is, or is becoming, the source's: a running upload counts, so the tick-list does
 *  not flicker while it runs. `uploadsRunning` holds the write until it lands. */
const holdsFile = (draft: SourceDraft): boolean =>
  draft.file !== null && draft.file.state !== "failed";

/** The editors against the evidence floor (`missingEventFields`). */
export function sourceFloor(drafts: SourceDraft[]): SourceFloorState {
  return {
    hasEvidenceFile: drafts.some((d) => d.level !== "context" && holdsFile(d)),
    missingLink: drafts.some((d) => draftUrls(d).length === 0),
    missingSensor: drafts.some((d) => holdsFile(d) && d.sensor === ""),
  };
}

/** Whether a source file is still uploading: the write waits for it. */
export function uploadsRunning(drafts: SourceDraft[]): boolean {
  return drafts.some((d) => d.file?.state === "uploading");
}

export const UPLOADS_RUNNING_MESSAGE = "Wait for the source files to finish uploading.";

/** A `datetime-local` value as the API reads it (UTC), or the stored instant when the input
 *  still holds what it was seeded with, so an untouched field keeps its seconds. */
function instant(input: string, stored: string | null): string | null {
  if (stored !== null && input === toDatetimeLocalUTC(stored)) return stored;
  return input || null;
}

/** The URLs a draft posts: trimmed, blanks and repeats dropped, as the server counts them. */
export function draftUrls(draft: SourceDraft): string[] {
  return [...new Set(draft.links.map((l) => l.url.trim()).filter(Boolean))];
}

/** One editor as the write posts it. */
export function sourceCreatePayload(draft: SourceDraft): SourceCreate {
  const file = fileReference(draft.file);
  const lat = cleanNumber(draft.cameraLat);
  const lng = cleanNumber(draft.cameraLng);
  const seen = new Set<string>();
  const links: SourceCreate["links"] = [];
  for (const link of draft.links) {
    const url = link.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const sameLink = link.stored?.url === url;
    links.push({
      url,
      posted_at: instant(link.postedAt, sameLink ? (link.stored?.postedAt ?? null) : null),
      snapshot_url: link.snapshotUrl.trim() || null,
    });
  }
  return {
    ...(draft.id ? { id: draft.id } : {}),
    title: draft.title.trim(),
    level: draft.level,
    // A sensor describes a file: a source without one names none.
    sensor: file.upload_id || file.media_id ? draft.sensor || null : null,
    captured_at: instant(draft.capturedAt, draft.storedCapturedAt),
    // Both halves or neither: a half-typed pair is dropped rather than refused.
    camera_position: lat !== null && lng !== null ? { lat, lng } : null,
    is_graphic: draft.isGraphic,
    links,
    tag_ids: draft.tagIds,
    ...file,
  };
}

/** The editors whose post would differ from the stored list. A copied or uploaded file, a new
 *  or removed source, or any moved field counts. Archived copies count too, since a pasted copy
 *  is an edit. */
export function sourcesChanged(stored: Source[], drafts: SourceDraft[]): boolean {
  if (stored.length !== drafts.length) return true;
  const byId = new Map(stored.map((s) => [s.id, s]));
  return drafts.some((draft) => {
    const source = draft.id ? byId.get(draft.id) : undefined;
    if (!source) return true;
    const posted = sourceCreatePayload(draft);
    if (posted.media_id !== source.media?.id || posted.upload_id) return true;
    if (draft.file?.state === "uploading" || draft.file?.state === "failed") return true;
    const camera = source.camera_position;
    const sameCamera =
      camera === null
        ? posted.camera_position === null
        : posted.camera_position?.lat === camera.lat && posted.camera_position?.lng === camera.lng;
    const storedLinks = source.links.map((l) => `${l.url} ${l.posted_at} ${l.archived?.url ?? ""}`);
    const postedLinks = posted.links.map(
      (l) => `${l.url} ${l.posted_at} ${l.snapshot_url ?? ""}`,
    );
    return (
      posted.title !== source.title ||
      posted.level !== source.level ||
      posted.sensor !== source.sensor ||
      posted.captured_at !== source.captured_at ||
      !sameCamera ||
      // The flag only rises on a stored source.
      (posted.is_graphic && !source.is_graphic) ||
      [...storedLinks].sort().join("\n") !== [...postedLinks].sort().join("\n") ||
      [...source.tags.map((t) => t.id)].sort().join() !== [...posted.tag_ids].sort().join()
    );
  });
}

/** `POST /uploads`: stage one source file before the event write that names it. */
export function uploadSourceFile(file: File): Promise<Upload> {
  const fd = new FormData();
  fd.append("file", file);
  return apiFetch<Upload>("/uploads", { method: "POST", body: fd });
}

/** Mirrors the `q` bounds of `GET /sources`; change both. */
export const SOURCE_PICKER_MIN_QUERY = 3;

/** `GET /sources`: existing sources whose title or one of whose URLs contains `q`. */
export function searchSources(q: string): Promise<SourcePick[]> {
  return apiFetch<SourcePick[]>(`/sources?q=${encodeURIComponent(q.trim())}&limit=10`);
}

/** The form sentence for each source error code an event write can answer. Mirrors the codes of
 *  backend `services/events/errors` and `services/uploads`; change both. */
const SOURCE_ERROR_MESSAGES: Record<string, string> = {
  source_required: "Add a direct or indirect source.",
  source_file_required: "Add a file to a direct or indirect source.",
  sensor_required: "Pick the sensor of every source that has a file.",
  source_link_required: "Every source needs at least one URL.",
  invalid_source_url: "A source URL is not a valid http or https link.",
  too_many_sources: "An event holds at most 10 sources.",
  too_many_source_links: "A source holds at most 10 URLs.",
  source_not_found: "A source changed since this form loaded. Reload the page and try again.",
  source_media_not_found:
    "A copied source file is no longer available. Remove that source or pick another.",
  upload_not_found: "A source file upload was not found. Remove the file and upload it again.",
  upload_expired: "A source file upload expired. Remove the file and upload it again.",
  too_many_uploads:
    "You have too many source files waiting to be used. Submit the forms that use them, or wait a day for them to expire.",
  conflict_required: "Pick at least one conflict.",
};

/** A `useMutation` `onError` for every event write: a source error code reads as its form
 *  sentence; anything else keeps the server's message. */
export function sourceWriteError(err: unknown): string | undefined {
  if (err instanceof ApiError && err.code && err.code in SOURCE_ERROR_MESSAGES) {
    return SOURCE_ERROR_MESSAGES[err.code];
  }
  return undefined;
}

/** A source upload's refusal as the file slot prints it. */
export function uploadError(err: unknown): string {
  if (err instanceof ApiError && err.code === "too_many_uploads") {
    return SOURCE_ERROR_MESSAGES.too_many_uploads;
  }
  return err instanceof Error ? err.message : "The upload failed. Try again.";
}

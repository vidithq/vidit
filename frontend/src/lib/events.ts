import { apiFetch } from "./api";
import type { components } from "@/lib/api-types";
import { archiveTooLarge } from "./archive";
import { cleanNumber, inBounds } from "./coordinates";
import { toDatetimeLocalUTC } from "./format";
import { proofHasImage } from "./proof";
import type {
  ArchiveImportJob,
  ArchiveImportPresign,
  ArchivedLink,
  EventDetail,
  EventVersion,
  EventStatus,
  Media,
  TagCategory,
  TweetImportOutcome,
} from "@/types";

/** A required field a create/edit form is still missing; `key` drives the in-form highlight. */
export type MissingFieldKey =
  | "title"
  | "coordinates"
  | "source_url"
  | "source_posted_at"
  | "proof"
  | "proof_image"
  | "source_media"
  | "conflict_tag"
  | "capture_source_tag";

export interface MissingField {
  key: MissingFieldKey;
  label: string;
}

/** One label per field key, read by the validators and the submit tick-list. */
export const FIELD_LABELS: Record<MissingFieldKey, string> = {
  title: "Title",
  coordinates: "Coordinates",
  source_url: "Source URL",
  source_posted_at: "Source post time",
  proof: "Proof",
  proof_image: "Proof image",
  source_media: "Source media",
  conflict_tag: "Conflict",
  capture_source_tag: "Capture source tag",
};

/** Mirrors `models/event.MAX_SECONDARY_SOURCE_LINKS`; change both. */
export const MAX_SECONDARY_SOURCE_LINKS = 10;

/** Below the backend default (`per_page=20`, max 100) so row previews load faster. */
const DETECTIONS_PER_PAGE = 10;

/** Detections loaded per review session, stepped through locally so a published row
 *  leaving the queue can't shift the position. The backend caps lists at 100 rows. */
const DETECTIONS_REVIEW_QUEUE = 100;

/** Queue filter for `GET /events/detections`. Hand-written like `EventView` (the router
 *  takes a plain `str`). Mirrors `services/events.DETECTION_READINESS`; change both. */
export type DetectionReadiness = "all" | "ready" | "incomplete";

/** Shape of `GET /events/detections`. Mirrors backend `PaginatedEventDetails`.
 *  `total` counts the set `readiness` selected; `ready_total` and `incomplete_total`
 *  count the whole queue under any filter. */
export interface PaginatedEventDetails {
  items: EventDetail[];
  total: number;
  page: number;
  per_page: number;
  ready_total: number;
  incomplete_total: number;
}

export function detectionsPath(
  page = 1,
  perPage = DETECTIONS_PER_PAGE,
  readiness: DetectionReadiness = "all",
): string {
  return `/events/detections?page=${page}&per_page=${perPage}&readiness=${readiness}`;
}

export function detectionsReviewPath(): string {
  return detectionsPath(1, DETECTIONS_REVIEW_QUEUE);
}

/** Marks an edit URL as a step of a review pass; every hop carries it so the walk
 *  survives a reload and Back. */
export const QUEUE_PARAM = "queue";

export function detectionEditPath(id: string, inQueue = false): string {
  return `/events/${id}/edit${inQueue ? `?${QUEUE_PARAM}=1` : ""}`;
}

/** Read views over the `events` table. Mirrors `event_filters.VIEWS`; see
 *  `docs/data-model.md`. */
export type EventView = "located" | "requested";

export interface EventListParams {
  view?: EventView;
  /** One status or several (repeated `?status=`, any-match). */
  status?: EventStatus | EventStatus[];
  tag?: string;
  author?: string;
  limit?: number;
  /** Cursor of the next page, from a `Link: rel="next"` header. */
  cursor?: string | null;
}

/** Build the `GET /events` query. The response caps at 100 rows; read further with the
 *  previous page's `cursor`. */
export function eventListPath(params: EventListParams = {}): string {
  const search = new URLSearchParams();
  if (params.view) search.set("view", params.view);
  if (params.status) {
    for (const status of [params.status].flat()) {
      search.append("status", status);
    }
  }
  if (params.tag) search.set("tag", params.tag);
  if (params.author) search.set("author", params.author);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return `/events${qs ? `?${qs}` : ""}`;
}

/** Camera-position pair to spread into the input. Both-or-neither: a lone half is
 *  dropped, a non-numeric pair clears it. */
export function parseCaptureCoords(
  latStr: string,
  lngStr: string
): { capture_source_lat: number; capture_source_lng: number } | Record<string, never> {
  const lat = cleanNumber(latStr);
  const lng = cleanNumber(lngStr);
  if (lat === null || lng === null) return {};
  return { capture_source_lat: lat, capture_source_lng: lng };
}

/** Optional subject-coordinate guess; same rules as `parseCaptureCoords`. */
export function parseGuessCoords(
  latStr: string,
  lngStr: string
): { lat: number; lng: number } | Record<string, never> {
  const lat = cleanNumber(latStr);
  const lng = cleanNumber(lngStr);
  if (lat === null || lng === null) return {};
  return { lat, lng };
}

export function getEvent(id: string): Promise<EventDetail> {
  return apiFetch<EventDetail>(`/events/${id}`);
}

/** Form state for geolocate and create. New media ride in `files`; existing media drop
 *  via `remove_media_ids`. */
export interface EventEditInput {
  title: string;
  lat: number;
  lng: number;
  /** Camera position; both halves or neither (a lone half is a 400). */
  capture_source_lat?: number;
  capture_source_lng?: number;
  source_url: string;
  /** Archived copy of `source_url`; one that isn't a snapshot of it fails the submit. */
  source_snapshot_url?: string;
  /** Mirrors of the same media, in order; blanks are dropped. */
  secondary_source_urls?: string[];
  /** Archived copy per mirror, index-aligned; a non-matching one fails the submit. */
  secondary_snapshot_urls?: string[];
  /** ISO `YYYY-MM-DD`; omitted when unknown. */
  event_date?: string;
  /** Optional ISO `HH:MM`; empty / omitted clears it. */
  event_time?: string;
  /** ISO UTC `YYYY-MM-DDTHH:MM`. Required on publish; omitted on `saveVersion` when
   *  empty so the row keeps its instant. */
  source_posted_at: string;
  proof?: Record<string, unknown> | null;
  /** Replaces the tag set wholesale. */
  tag_ids: string[];
  /** Replaces the conflict set wholesale. */
  conflict_ids: string[];
  /** Footage shows death, injury or human remains; blurs media behind an age confirmation. */
  is_graphic?: boolean;
  remove_media_ids: string[];
  files: File[];
  /** Inline proof images, uploaded at publish; matched to `placeholder://<filename>` srcs,
   *  which the server rewrites. */
  proof_files: File[];
}

/** Multipart fields shared by every write path (metadata, camera point, tags). */
function appendSharedEventFields(
  fd: FormData,
  input: {
    title: string;
    /** Optional on the version path alone (omitted keeps the stored source). */
    source_url?: string;
    source_snapshot_url?: string;
    secondary_source_urls?: string[];
    secondary_snapshot_urls?: string[];
    source_posted_at: string;
    proof?: Record<string, unknown> | null;
    capture_source_lat?: number;
    capture_source_lng?: number;
    event_time?: string;
    tag_ids?: string[];
    conflict_ids?: string[];
    is_graphic?: boolean;
  }
): void {
  fd.append("title", input.title);
  // Always sent: geolocate posts the whole state, so omission would clear the flag.
  fd.append("is_graphic", String(input.is_graphic ?? false));
  if (input.source_url !== undefined) fd.append("source_url", input.source_url);
  if (input.source_snapshot_url?.trim()) {
    fd.append("source_snapshot_url", input.source_snapshot_url.trim());
  }
  // Repeated form fields paired by position. Blank mirrors are dropped with their snapshot;
  // the snapshot is posted even when empty so position i names mirror i.
  const mirrors = input.secondary_source_urls ?? [];
  const mirrorCopies = input.secondary_snapshot_urls ?? [];
  mirrors.forEach((url, index) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    fd.append("secondary_source_urls", trimmed);
    fd.append("secondary_snapshot_urls", (mirrorCopies[index] ?? "").trim());
  });
  // Both-or-neither, matching backend `_optional_point`.
  if (input.capture_source_lat !== undefined && input.capture_source_lng !== undefined) {
    fd.append("capture_source_lat", String(input.capture_source_lat));
    fd.append("capture_source_lng", String(input.capture_source_lng));
  }
  if (input.event_time) fd.append("event_time", input.event_time);
  // Omitted when empty: on save_version an absent value keeps the stored instant.
  // Publish paths reject its absence.
  if (input.source_posted_at) {
    fd.append("source_posted_at", input.source_posted_at);
  }
  if (input.proof) fd.append("proof", JSON.stringify(input.proof));
  if (input.tag_ids && input.tag_ids.length > 0) {
    fd.append("tag_ids", JSON.stringify(input.tag_ids));
  }
  if (input.conflict_ids && input.conflict_ids.length > 0) {
    fd.append("conflict_ids", JSON.stringify(input.conflict_ids));
  }
}

/** Multipart fields every geolocation write posts. `sourceKey` is `file` for
 *  create/request, `files` for geolocate and versions. */
function appendEventFormFields(
  fd: FormData,
  input: Omit<EventEditInput, "remove_media_ids" | "source_url" | "files"> & {
    source_url?: string;
    files?: File[];
    remove_media_ids?: string[];
  },
  sourceKey: "file" | "files" = "files"
): void {
  appendSharedEventFields(fd, input);
  fd.append("lat", String(input.lat));
  fd.append("lng", String(input.lng));
  if (input.event_date) {
    fd.append("event_date", input.event_date);
  }
  for (const file of input.files ?? []) {
    fd.append(sourceKey, file);
  }
  // Rows the replacement file swaps out; a create never sends this.
  if (input.remove_media_ids?.length) {
    fd.append("remove_media_ids", JSON.stringify(input.remove_media_ids));
  }
  // Matched to `placeholder://` srcs by filename server-side.
  for (const file of input.proof_files) {
    fd.append("proof_files", file);
  }
}

/** Give an event a vouched location: `requested` | `detected` → `geolocated`.
 *  `POST /events/{id}/geolocate`. */
export function geolocateEvent(
  id: string,
  input: EventEditInput
): Promise<EventDetail> {
  const fd = new FormData();
  appendEventFormFields(fd, input);
  return apiFetch<EventDetail>(`/events/${id}/geolocate`, {
    method: "POST",
    body: fd,
  });
}

export type EventCreateInput = Omit<EventEditInput, "remove_media_ids">;

/** Mirrors `schemas/event.VERSION_NOTE_MAX_LENGTH`; change both. */
export const VERSION_NOTE_MAX_LEN = 280;

/** A correction to a published event: the geolocate form, whole. `source_url` is
 *  optional here alone (omitted keeps the stored source). */
export type EventVersionInput = Omit<EventEditInput, "source_url"> & {
  /** Omitted or empty keeps the stored URL; whitespace-only is a 400. */
  source_url?: string;
  /** Editor's note, stored on the superseded version. Capped at `VERSION_NOTE_MAX_LEN`. */
  note?: string;
  /** Snapshot of `detected_from_url`. Only this endpoint takes it, since that link is immutable. */
  detected_from_snapshot_url?: string;
};

/** `POST /events/{id}/versions`: owner-only, `geolocated`-only. Files the superseded
 *  state as a version. */
export function saveVersion(
  id: string,
  input: EventVersionInput
): Promise<EventDetail> {
  const fd = new FormData();
  appendEventFormFields(fd, input);
  if (input.note?.trim()) {
    fd.append("note", input.note.trim());
  }
  if (input.detected_from_snapshot_url?.trim()) {
    fd.append("detected_from_snapshot_url", input.detected_from_snapshot_url.trim());
  }
  return apiFetch<EventDetail>(`/events/${id}/versions`, {
    method: "POST",
    body: fd,
  });
}

// Version history: reads behind /events/{id}/history and /vN.

/** Cursor is the previous page's `Link: rel="next"` value, `null` for the first. */
export function eventVersionsPath(id: string, cursor: string | null): string {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return `/events/${id}/versions${query ? `?${query}` : ""}`;
}

export function eventVersionPath(id: string, versionNo: number): string {
  return `/events/${id}/versions/${versionNo}`;
}

/** Past versions only; the current one keeps `/events/{id}`. */
export function eventVersionHref(id: string, versionNo: number): string {
  return `/events/${id}/v${versionNo}`;
}

export function eventHistoryHref(id: string): string {
  return `/events/${id}/history`;
}

/** Whether the row was ever published, retraction included. Asking this instead of
 *  `status === "geolocated"` keeps history reachable after a retraction. */
export function hasPublishedRecord(
  geo: Pick<EventDetail, "status" | "before_closed_status">
): boolean {
  return (
    geo.status === "geolocated" ||
    (geo.status === "closed" && geo.before_closed_status === "geolocated")
  );
}

/** Version number of a `vN` segment, or `null` (`v0` and other shapes, so the route 404s). */
export function parseVersionSegment(segment: string): number | null {
  if (!/^v[1-9][0-9]*$/.test(segment)) return null;
  return Number(segment.slice(1));
}

/** One label per versioned field, in changed-list order. Keyed by the fields
 *  `services/versions.build_snapshot` files. */
const VERSION_FIELD_LABELS = {
  title: "Title",
  source_url: "Source URL",
  source_media: "Source media",
  event_coords: "Coordinates",
  capture_source_coords: "Camera position",
  event_date: "Event date",
  event_time: "Event time",
  source_posted_at: "Source posted",
  conflicts: "Conflict",
  tags: "Tags",
  secondary_source_urls: "Secondary sources",
  archives: "Archived copies",
  proof: "Proof",
  is_graphic: "Graphic flag",
} as const;

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asCoords = (value: unknown): EventDetail["event_coords"] => {
  if (value === null || typeof value !== "object") return null;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
};

const asList = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Archived copies an event view carries, keyed by covered link. The read shape spreads
 *  them over three fields; this one walk gathers them so the version overlay, the
 *  changed-field list and the edit form agree. */
export function archivedCopies(view: EventDetail): Map<string, ArchivedLink> {
  const copies = new Map<string, ArchivedLink>();
  const add = (url: string | null, copy: ArchivedLink | null | undefined) => {
    if (url && copy) copies.set(url, copy);
  };
  add(view.source_url, view.archived_source);
  add(view.detected_from_url, view.archived_detected_from);
  view.secondary_source_urls.forEach((url, index) =>
    add(url, view.archived_secondary_sources[index])
  );
  return copies;
}

/** Archived copies one filed version held (`services/versions.build_snapshot`), keyed by
 *  link. A snapshot without an `archives` key (pre-versioning or redacted) falls back to
 *  the live row's copies, so no phantom change prints. */
function snapshotArchivedCopies(
  snapshot: EventVersion["snapshot"],
  current: EventDetail
): Map<string, ArchivedLink> {
  if (!Array.isArray(snapshot.archives)) return archivedCopies(current);
  const copies = new Map<string, ArchivedLink>();
  for (const entry of asList<Record<string, unknown>>(snapshot.archives)) {
    const original = asNullableString(entry?.original_url);
    const url = asNullableString(entry?.snapshot_url);
    const provider = entry?.provider;
    if (
      original &&
      url &&
      (provider === "wayback" || provider === "archive_today" || provider === "ghostarchive")
    ) {
      copies.set(original, { url, provider });
    }
  }
  return copies;
}

/** One filed version as the event shape every surface renders.
 *  The anchor (`source_url`, `source_media`) is read from the snapshot alone, never the live
 *  row, so the changed-field list sees different values across a media swap. Identity (id,
 *  owner, status, creation date) comes from the current row.
 *  Archived copies are re-spread over the three fields by link, not position. A conflict
 *  resolves to the live row when its id still exists, else the stored name, so a version
 *  survives a rename or delete.
 *  The snapshot is untyped JSON, so every field is read defensively; a redacted `{}`
 *  snapshot maps to the current row's immutables and empty content. */
export function snapshotToEventView(
  current: EventDetail,
  version: EventVersion
): EventDetail {
  const snapshot = version.snapshot;
  const archivedByUrl = snapshotArchivedCopies(snapshot, current);
  const conflictsById = new Map(current.conflicts.map((c) => [c.id, c]));
  const secondarySourceUrls = asList<string>(snapshot.secondary_source_urls);
  const sourceUrl = asNullableString(snapshot.source_url);
  const media = asList<Media>(snapshot.source_media);
  return {
    ...current,
    version_no: version.version_no,
    source_url: sourceUrl,
    media,
    // Derived from the same media, so a preview shows the footage this version rested on.
    thumbnail: media[0] ?? null,
    archived_source: archivedByUrl.get(sourceUrl ?? "") ?? null,
    archived_detected_from: archivedByUrl.get(current.detected_from_url ?? "") ?? null,
    title: asString(snapshot.title, current.title),
    event_coords: asCoords(snapshot.event_coords),
    capture_source_coords: asCoords(snapshot.capture_source_coords),
    event_date: asNullableString(snapshot.event_date),
    event_time: asNullableString(snapshot.event_time),
    source_posted_at: asNullableString(snapshot.source_posted_at),
    // Ratcheted against the live row like the backend column: the media shown is the live
    // media, so a flag raised later still covers it.
    is_graphic: current.is_graphic || snapshot.is_graphic === true,
    secondary_source_urls: secondarySourceUrls,
    archived_secondary_sources: secondarySourceUrls.map(
      (url) => archivedByUrl.get(url) ?? null
    ),
    tags: asList<EventDetail["tags"][number]>(snapshot.tags),
    conflicts: asList<{ id: string; name: string }>(snapshot.conflicts).map(
      (stored) =>
        conflictsById.get(stored.id) ?? {
          id: stored.id,
          name: stored.name,
          ongoing: false,
          start_year: null,
          end_year: null,
          tier: null,
          wikidata_id: null,
        }
    ),
    proof: (snapshot.proof as Record<string, unknown> | null | undefined) ?? null,
  };
}

/** Same moment whatever the spelling (`+00:00` vs `Z`); unparseable values compare as strings. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const [left, right] = [Date.parse(a), Date.parse(b)];
  return isNaN(left) || isNaN(right) ? a === b : left === right;
}

const sameCoords = (
  a: EventDetail["event_coords"],
  b: EventDetail["event_coords"]
): boolean => (a === null || b === null ? a === b : a.lat === b.lat && a.lng === b.lng);

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Same time to the minute: the API serves `HH:MM:SS`, the time input holds `HH:MM`. */
const sameTime = (a: string | null, b: string | null): boolean =>
  (a?.slice(0, 5) ?? null) === (b?.slice(0, 5) ?? null);

/** Same members in any order (the API serves tags and conflicts unordered). */
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  sameList([...a].sort(), [...b].sort());

/** A version's archived copies as comparable (link, snapshot) pairs; the snapshot host implies the provider. */
const archivedPairs = (view: EventDetail): string[] =>
  [...archivedCopies(view)].map(([original, copy]) => `${original} ${copy.url}`);

/** Labels of the versioned fields that differ between a version and the one before it,
 *  computed client side from two adjacent views. Tags and conflicts compare by id, as
 *  sets. Inline images are not their own entry (they live in the proof). Archived copies
 *  compare as (link, snapshot) pairs. */
export function changedFields(version: EventDetail, previous: EventDetail): string[] {
  const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);
  const changed: string[] = [];
  const flag = (label: string, differs: boolean) => {
    if (differs) changed.push(label);
  };
  flag(VERSION_FIELD_LABELS.title, version.title !== previous.title);
  flag(VERSION_FIELD_LABELS.source_url, version.source_url !== previous.source_url);
  // By identity: a swap is a new row.
  flag(VERSION_FIELD_LABELS.source_media, !sameList(ids(version.media), ids(previous.media)));
  flag(
    VERSION_FIELD_LABELS.event_coords,
    !sameCoords(version.event_coords, previous.event_coords)
  );
  flag(
    VERSION_FIELD_LABELS.capture_source_coords,
    !sameCoords(version.capture_source_coords, previous.capture_source_coords)
  );
  flag(VERSION_FIELD_LABELS.event_date, version.event_date !== previous.event_date);
  flag(VERSION_FIELD_LABELS.event_time, !sameTime(version.event_time, previous.event_time));
  flag(
    VERSION_FIELD_LABELS.source_posted_at,
    !sameInstant(version.source_posted_at, previous.source_posted_at)
  );
  flag(
    VERSION_FIELD_LABELS.conflicts,
    !sameSet(ids(version.conflicts), ids(previous.conflicts))
  );
  flag(VERSION_FIELD_LABELS.tags, !sameSet(ids(version.tags), ids(previous.tags)));
  flag(
    VERSION_FIELD_LABELS.secondary_source_urls,
    !sameList(version.secondary_source_urls, previous.secondary_source_urls)
  );
  flag(
    VERSION_FIELD_LABELS.archives,
    !sameSet(archivedPairs(version), archivedPairs(previous))
  );
  flag(
    VERSION_FIELD_LABELS.proof,
    JSON.stringify(version.proof ?? null) !== JSON.stringify(previous.proof ?? null)
  );
  flag(VERSION_FIELD_LABELS.is_graphic, version.is_graphic !== previous.is_graphic);
  return changed;
}

/** The edit form's state as the strings its inputs carry (typed values, not posted values). */
export interface EventVersionFormState {
  title: string;
  /** Blank keeps the stored URL, like an omitted field. */
  sourceUrl: string;
  /** A staged source-media swap (row marked for removal or file queued); not comparable as a
   *  value since an upload has no URL yet. */
  sourceMediaMoved: boolean;
  lat: string;
  lng: string;
  captureLat: string;
  captureLng: string;
  eventDate: string;
  eventTime: string;
  sourcePostedAt: string;
  isGraphic: boolean;
  proof: Record<string, unknown> | null;
  tagIds: string[];
  conflictIds: string[];
  secondarySourceUrls: string[];
  secondarySnapshotUrls: string[];
  sourceSnapshotUrl: string;
  detectedFromSnapshotUrl: string;
}

const coordsOf = (lat: string, lng: string): EventDetail["event_coords"] => {
  const [parsedLat, parsedLng] = [cleanNumber(lat), cleanNumber(lng)];
  return parsedLat === null || parsedLng === null ? null : { lat: parsedLat, lng: parsedLng };
};

/** Whether saving would file a version that differs from the one on screen. The server
 *  refuses the same edit with `nothing_changed` and is the authority (the row may have
 *  moved).
 *  Delegates to `changedFields` over a candidate built from the form, except two legs:
 *  archived copies (a paste counts only where it differs from the link's stored copy,
 *  and re-spreading would have to invent providers) and source media (a queued upload
 *  has no id to compare). */
export function hasVersionChanges(
  geo: EventDetail,
  state: EventVersionFormState
): boolean {
  const mirrors: string[] = [];
  const pastedCopies = new Map<string, string>();
  state.secondarySourceUrls.forEach((raw, index) => {
    const url = raw.trim();
    if (!url) return;
    mirrors.push(url);
    const copy = (state.secondarySnapshotUrls[index] ?? "").trim();
    if (copy) pastedCopies.set(url, copy);
  });
  const sourceCopy = state.sourceSnapshotUrl.trim();
  if (sourceCopy && geo.source_url) pastedCopies.set(geo.source_url, sourceCopy);
  const provenanceCopy = state.detectedFromSnapshotUrl.trim();
  if (provenanceCopy && geo.detected_from_url) {
    pastedCopies.set(geo.detected_from_url, provenanceCopy);
  }
  const stored = archivedCopies(geo);
  const copiesMove = [...pastedCopies].some(([url, copy]) => stored.get(url)?.url !== copy);
  if (copiesMove || state.sourceMediaMoved) return true;

  const candidate: EventDetail = {
    ...geo,
    title: state.title.trim(),
    // Blank keeps the stored source, like the server.
    source_url: state.sourceUrl.trim() || geo.source_url,
    event_coords: coordsOf(state.lat, state.lng),
    capture_source_coords: coordsOf(state.captureLat, state.captureLng),
    event_date: state.eventDate || null,
    event_time: state.eventTime || null,
    // Compared at the input's minute precision: an untouched field is unchanged however many
    // seconds the column carries, and a blanked one keeps the row's value. The input is a UTC
    // wall clock, hence the `Z`.
    source_posted_at:
      state.sourcePostedAt &&
      state.sourcePostedAt !== toDatetimeLocalUTC(geo.source_posted_at)
        ? `${state.sourcePostedAt}Z`
        : geo.source_posted_at,
    // Ratcheted like the server: clearing the switch on a flagged row changes nothing.
    is_graphic: geo.is_graphic || state.isGraphic,
    secondary_source_urls: mirrors,
    // Realigned with `mirrors`; `archivedCopies` pairs by position.
    archived_secondary_sources: mirrors.map((url) => stored.get(url) ?? null),
    // Only the ids are compared, so the rest of each row is the loaded one.
    tags: state.tagIds.map((id) => ({ id })) as EventDetail["tags"],
    conflicts: state.conflictIds.map((id) => ({ id })) as EventDetail["conflicts"],
    proof: state.proof,
  };
  return changedFields(candidate, geo).length > 0;
}

/** Word for word the sentence `services/events.save_version` raises with
 *  `nothing_changed`; the form prefers the server's message when it has one. */
export const nothingChangedMessage = (versionNo: number): string =>
  `Nothing changed since version ${versionNo}.`;

export interface EventVersionEntry {
  /** Which version this is. `1` is the record as it was published. */
  number: number;
  /** True for the live row, the one `/events/{id}` serves. */
  current: boolean;
  /** The event at this version, or `null` when redacted. */
  view: EventDetail | null;
  /** Who produced this version and when; `null` when the carrying row could not be read. */
  editor: EventDetail["owner"] | null;
  createdAt: string | null;
  /** That editor's own words about the edit, `null` when they left none. */
  note: string | null;
  redacted: boolean;
  /** Fields changed against the previous version; `null` when not comparable (version 1, or
   *  a redacted side). */
  changed: string[] | null;
}

/** Rows one version is assembled from. `own` is its content (absent for the live row);
 *  `producedBy` is the row numbered one lower, since the API files an edit's byline on the
 *  version it superseded; `previous` is that lower version's view, the diff base. */
export interface EventVersionEntryRows {
  own?: EventVersion | null;
  producedBy?: EventVersion | null;
  previous?: EventDetail | null;
}

/** One version, described by the edit that produced it. Content comes from row `n`,
 *  authorship from row `n - 1`; version 1 takes the publisher and `geolocated_at` (not
 *  `created_at`, which is when the record was opened). A version above 1 with no producing
 *  row states neither byline nor date rather than crediting the publication. */
export function eventVersion(
  current: EventDetail,
  number: number,
  { own = null, producedBy = null, previous = null }: EventVersionEntryRows = {}
): EventVersionEntry {
  const isCurrent = number === current.version_no;
  const view = isCurrent
    ? current
    : own && !own.redacted
      ? snapshotToEventView(current, own)
      : null;
  return {
    number,
    current: isCurrent,
    view,
    editor: producedBy ? producedBy.edited_by : number === 1 ? current.owner : null,
    createdAt: producedBy
      ? producedBy.created_at
      : number === 1
        ? current.geolocated_at
        : null,
    note: producedBy?.note ?? null,
    redacted: own?.redacted ?? false,
    changed: view && previous ? changedFields(view, previous) : null,
  };
}

/** Versions newest first. While `hasMore`, the oldest loaded row is authorship for the
 *  version above it, so it is held back until the completing page arrives: no version
 *  number appears without an editor. */
export function eventVersions(
  current: EventDetail,
  rows: EventVersion[],
  hasMore = false
): EventVersionEntry[] {
  const byNumber = new Map(rows.map((row) => [row.version_no, row]));
  // `+ 1`: while paging, the lowest loaded row is only authorship for the version above, so
  // stop one above it. A finished walk reaches version 1.
  const oldest = hasMore && rows.length > 0 ? Math.min(...byNumber.keys()) + 1 : 1;

  // Diff base only; the content is the same snapshot.
  const viewOf = (number: number): EventDetail | null =>
    eventVersion(current, number, { own: byNumber.get(number) }).view;

  const entries: EventVersionEntry[] = [];
  for (let number = current.version_no; number >= oldest; number--) {
    const own = byNumber.get(number);
    if (number !== current.version_no && own === undefined) break;
    entries.push(
      eventVersion(current, number, {
        own,
        producedBy: byNumber.get(number - 1),
        previous: number > 1 ? viewOf(number - 1) : null,
      })
    );
  }
  return entries;
}

/** `POST /events` (multipart); returns the new id. */
export function createEvent(input: EventCreateInput): Promise<{ id: string }> {
  const fd = new FormData();
  appendEventFormFields(fd, input, "file");
  return apiFetch<{ id: string }>("/events", {
    method: "POST",
    body: fd,
  });
}

/** Open a request: `POST /events/requests` (multipart). The coordinate guess is
 *  both-or-neither; one source media file is required. */
export interface EventRequestInput {
  title: string;
  source_url: string;
  /** Snapshot of `source_url`, same contract as a geolocation's. */
  source_snapshot_url?: string;
  /** Mirrors, same contract as a geolocation's. */
  secondary_source_urls?: string[];
  /** Snapshot per mirror, index-aligned. */
  secondary_snapshot_urls?: string[];
  proof?: Record<string, unknown> | null;
  /** Optional approximate guess: both halves or neither. */
  lat?: number;
  lng?: number;
  /** Optional camera position; both halves or neither. */
  capture_source_lat?: number;
  capture_source_lng?: number;
  /** Optional, ISO YYYY-MM-DD: when the event happened. */
  event_date?: string;
  /** Optional, ISO HH:MM: event time-of-day (UTC). */
  event_time?: string;
  /** ISO datetime (`YYYY-MM-DDTHH:MM`, UTC): when the source posted. Required. */
  source_posted_at: string;
  is_graphic?: boolean;
  tag_ids?: string[];
  conflict_ids?: string[];
  files: File[];
  /** Inline proof images, uploaded at publish. Optional on a request, which may be unfinished. */
  proof_files: File[];
}

/** Multipart fields both request write paths post. Unlike a geolocation, the subject point
 *  is optional per half and proof images have no image floor. */
function appendRequestFormFields(
  fd: FormData,
  input: EventRequestInput & { remove_media_ids?: string[] },
  sourceKey: "file" | "files"
): void {
  appendSharedEventFields(fd, input);
  if (input.lat !== undefined) fd.append("lat", String(input.lat));
  if (input.lng !== undefined) fd.append("lng", String(input.lng));
  if (input.event_date) {
    fd.append("event_date", input.event_date);
  }
  for (const file of input.files) {
    fd.append(sourceKey, file);
  }
  if (input.remove_media_ids?.length) {
    fd.append("remove_media_ids", JSON.stringify(input.remove_media_ids));
  }
  for (const file of input.proof_files) {
    fd.append("proof_files", file);
  }
}

export function createEventRequest(input: EventRequestInput): Promise<EventDetail> {
  const fd = new FormData();
  appendRequestFormFields(fd, input, "file");
  return apiFetch<EventDetail>("/events/requests", {
    method: "POST",
    body: fd,
  });
}

/** Correct an open request: `POST /events/{id}/request`, owner-only, `requested`-only. No
 *  version is filed (a request is a question, not a vouched claim): the row is overwritten. */
export type EventRequestEditInput = EventRequestInput & {
  /** Existing source media to drop; the replacement rides in `files`. */
  remove_media_ids: string[];
  /** Optional here: the bot opens requests whose source date it could not read. Empty keeps
   *  the stored value. */
  source_posted_at: string;
};

export function updateEventRequest(
  id: string,
  input: EventRequestEditInput
): Promise<EventDetail> {
  const fd = new FormData();
  appendRequestFormFields(fd, input, "files");
  return apiFetch<EventDetail>(`/events/${id}/request`, {
    method: "POST",
    body: fd,
  });
}

/** `POST /events/import-from-tweet`: runs detection over one of your own X posts and
 *  returns the detections created, updated or left alone, plus warnings. */
export function importFromPost(url: string): Promise<TweetImportOutcome> {
  return apiFetch<TweetImportOutcome>("/events/import-from-tweet", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

/** Step 1: `POST /events/import-archive/presign` mints the staging key and a presigned upload target. */
export function presignArchiveUpload(): Promise<ArchiveImportPresign> {
  return apiFetch<ArchiveImportPresign>("/events/import-archive/presign", {
    method: "POST",
  });
}

/** The upload leg failed in transit; nothing is staged, so a retry is safe. Distinct from
 *  `archive_too_large`, which is terminal. */
export class ArchiveUploadError extends Error {
  constructor() {
    super("The upload didn't complete. Check your connection and try again.");
    this.name = "ArchiveUploadError";
  }
}

/** `detail` prefixes of the dev upload endpoint's 413s (`backend/app/main.py`): its size
 *  guard and the body-size middleware. */
const DEV_UPLOAD_TOO_LARGE_DETAILS = [
  "Upload exceeds the size guard",
  "Request body too large",
];

/** Whether a 413 came from the dev upload endpoint rather than an intermediary. */
function isDevUploadTooLarge(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const detail = (parsed as { detail?: unknown } | null)?.detail;
  if (typeof detail !== "string") return false;
  return DEV_UPLOAD_TOO_LARGE_DETAILS.some((prefix) => detail.startsWith(prefix));
}

/** Classify a non-2xx from the storage POST. An over-cap body is terminal (S3: 400
 *  `EntityTooLarge`; dev endpoint: 413). The 413 is matched on that endpoint's body, since
 *  a proxy can 413 an under-cap body and a retry would work. Everything else is transit. */
function uploadFailure(status: number, body: string): Error {
  const tooLarge =
    body.includes("<Code>EntityTooLarge</Code>") ||
    (status === 413 && isDevUploadTooLarge(body));
  return tooLarge ? archiveTooLarge() : new ArchiveUploadError();
}

/** Step 2: POST the stripped zip straight to storage. XHR for progress events; `fields`
 *  precede the file part (S3 ignores later ones); no credentials (the presigned policy
 *  authorizes). `onProgress` gets raw byte counts. */
export function uploadArchive(
  upload: ArchiveImportPresign["upload"],
  file: File,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) {
      fd.append(name, value);
    }
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", upload.url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(uploadFailure(xhr.status, xhr.responseText ?? ""));
    xhr.onerror = () => reject(new ArchiveUploadError());
    xhr.send(fd);
  });
}

/** Step 3: `POST /events/import-archive` verifies the staged object and enqueues the
 *  backfill (202, `queued`). The worker lands rows as `detected` and emails the outcome.
 *  `postEstimate` is the strip's cosmetic volume hint. */
export function enqueueArchiveImport(
  uploadKey: string,
  postEstimate: number
): Promise<ArchiveImportJob> {
  return apiFetch<ArchiveImportJob>("/events/import-archive", {
    method: "POST",
    body: JSON.stringify({ upload_key: uploadKey, post_estimate: postEstimate }),
  });
}

export function getImportJob(jobId: string): Promise<ArchiveImportJob> {
  return apiFetch<ArchiveImportJob>(`/events/import-archive/${jobId}`);
}

/** The poll gave up while the job may still land: lost sight, not failure. The completion
 *  email is the durable signal. */
export class ImportPollLost extends Error {}

/** Poll until the job is `done` or `failed`. Transient errors retry; `maxErrors`
 *  consecutive misses or `timeoutMs` throw `ImportPollLost`. */
export async function awaitImportJob(
  jobId: string,
  {
    intervalMs = 2500,
    maxErrors = 8,
    timeoutMs = 15 * 60_000,
    onUpdate,
  }: {
    intervalMs?: number;
    maxErrors?: number;
    timeoutMs?: number;
    /** Fires on every successful poll, for live progress. */
    onUpdate?: (job: ArchiveImportJob) => void;
  } = {}
): Promise<ArchiveImportJob> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveErrors = 0;
  for (;;) {
    try {
      const job = await getImportJob(jobId);
      consecutiveErrors = 0;
      onUpdate?.(job);
      if (job.status === "done" || job.status === "failed") return job;
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxErrors) {
        throw new ImportPollLost("import job polling lost after repeated errors");
      }
    }
    if (Date.now() >= deadline) {
      throw new ImportPollLost("import job polling timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Human labels of what stops a detection from publishing; empty means "ready" (only the
 *  conflict and capture-source choices remain).
 *  Mirrors the server floor in `services/events/batch._publish_detection`, and only that:
 *  form-level requirements (title, source post time) are excluded. The server stays the
 *  authority. `services/events.detection_ready_predicate` is the SQL behind the queue's
 *  `readiness` filter; both are held to `backend/tests/events/_readiness_cases.py` and its
 *  mirror in `events.test.ts`. */
export function batchCompletionBlockers(geo: {
  event_coords: unknown | null;
  source_url: string | null;
  proof: Record<string, unknown> | null;
  media: readonly Pick<Media, "role">[];
}): string[] {
  // In the server's check order.
  const missing: string[] = [];
  if (!geo.source_url?.trim()) missing.push(FIELD_LABELS.source_url);
  if (!geo.event_coords) missing.push(FIELD_LABELS.coordinates);
  // The floor is a `source` media row; `Pick<Media, "role">` keeps tsc holding it there.
  if (!geo.media.some((m) => m.role === "source")) missing.push(FIELD_LABELS.source_media);
  // The leg the queue most often has to flag.
  if (!geo.proof || !proofHasImage(geo.proof)) missing.push(FIELD_LABELS.proof_image);
  return missing;
}

/** `POST /events/{id}/close`: withdraw a request, reject a detection, or retract a
 *  geolocation (owner-only). The reason is public, so required; closing is terminal. */
export function closeEvent(id: string, closeReason: string): Promise<EventDetail> {
  return apiFetch<EventDetail>(`/events/${id}/close`, {
    method: "POST",
    body: JSON.stringify({ close_reason: closeReason }),
  });
}

/** Report buckets, aliased from the generated spec so a backend rename fails `tsc`. */
export type ContentReportReason =
  components["schemas"]["ContentReportCreate"]["reason"];

/** One report as the admin queue reads it (`resolved_at === null` means open). */
export type ContentReport = components["schemas"]["ContentReportRead"];

/** Mirrors `schemas/report.DETAILS_MAX_LENGTH`; change both. */
export const REPORT_DETAILS_MAX_LEN = 2000;

/** One label per report bucket, shared by the report form and the admin queue. Keyed by the
 *  generated union so a new backend reason fails `tsc`. */
export const REPORT_REASON_LABELS: Record<ContentReportReason, string> = {
  illegal_content: "Illegal content",
  graphic_not_flagged: "Graphic content, not flagged",
  copyright: "Copyright",
  privacy: "Privacy",
  other: "Something else",
};

/** `POST /events/{id}/report`. Open to anyone: `apiFetch` omits the CSRF header with no
 *  session cookie. The backend caps it per IP. */
export function reportEvent(
  id: string,
  body: components["schemas"]["ContentReportCreate"]
): Promise<ContentReport> {
  return apiFetch<ContentReport>(`/events/${id}/report`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Raw input values a geolocation form validates before submit. */
export interface EventFieldsState {
  title: string;
  lat: string;
  lng: string;
  sourceUrl: string;
  /** ISO datetime (datetime-local value, UTC). Required. */
  sourcePostedAt: string;
  proof: Record<string, unknown> | null;
  /** Source-media count after staging (kept existing + newly staged). */
  mediaCount: number;
  hasConflictTag: boolean;
  hasCaptureSourceTag: boolean;
}

export interface EventFieldsOptions {
  /** Require >=1 source media (false when a request supplies it). Default true. */
  requireMedia?: boolean;
  /** Require the conflict + capture-source tag floor. Default true. */
  requireTags?: boolean;
  /** Require the source post time. Default true; false on a version, since a detection
   *  published with a NULL post time must stay editable (`POST /events/{id}/versions`
   *  takes it as optional). */
  requireSourcePostedAt?: boolean;
}

/** Every unmet required field for a geolocation, all at once: `label` for
 *  `IncompleteFormNotice`, `key` for the highlight. Mirrors the backend submit check.
 *  Proof must carry an image (`proofHasImage`): text alone can't be audited. */
export function missingEventFields(
  s: EventFieldsState,
  {
    requireMedia = true,
    requireTags = true,
    requireSourcePostedAt = true,
  }: EventFieldsOptions = {}
): MissingField[] {
  // Strict parse like `cleanNumber`: `"48.85abc"` is missing, not truncated to 48.85.
  const lat = cleanNumber(s.lat);
  const lng = cleanNumber(s.lng);
  const coordsValid = lat !== null && lng !== null && inBounds(lat, lng);

  const missing: MissingField[] = [];
  if (!s.title.trim()) missing.push({ key: "title", label: FIELD_LABELS.title });
  if (!coordsValid) missing.push({ key: "coordinates", label: FIELD_LABELS.coordinates });
  if (!s.sourceUrl.trim()) missing.push({ key: "source_url", label: FIELD_LABELS.source_url });
  if (requireSourcePostedAt && !s.sourcePostedAt) {
    missing.push({ key: "source_posted_at", label: FIELD_LABELS.source_posted_at });
  }
  // "Proof" (none) and "Proof image" (text-only) are distinct misses.
  if (!s.proof) {
    missing.push({ key: "proof", label: FIELD_LABELS.proof });
  } else if (!proofHasImage(s.proof)) {
    missing.push({ key: "proof_image", label: FIELD_LABELS.proof_image });
  }
  if (requireMedia && s.mediaCount === 0) {
    missing.push({ key: "source_media", label: FIELD_LABELS.source_media });
  }
  if (requireTags && !s.hasConflictTag) {
    missing.push({ key: "conflict_tag", label: FIELD_LABELS.conflict_tag });
  }
  if (requireTags && !s.hasCaptureSourceTag) {
    missing.push({ key: "capture_source_tag", label: FIELD_LABELS.capture_source_tag });
  }
  return missing;
}

/** Every unmet required field for a request: a title, the source and the footage. Mirrors
 *  `POST /events/requests`. `requireSourcePostedAt` is false on the owner's edit, since the
 *  bot opens requests whose source date it could not read. */
export function missingEventRequestFields(
  s: {
    title: string;
    sourceUrl: string;
    sourcePostedAt: string;
    mediaCount: number;
  },
  { requireSourcePostedAt = true }: { requireSourcePostedAt?: boolean } = {}
): MissingField[] {
  const missing: MissingField[] = [];
  if (!s.title.trim()) missing.push({ key: "title", label: FIELD_LABELS.title });
  if (!s.sourceUrl.trim()) missing.push({ key: "source_url", label: FIELD_LABELS.source_url });
  if (requireSourcePostedAt && !s.sourcePostedAt) {
    missing.push({ key: "source_posted_at", label: FIELD_LABELS.source_posted_at });
  }
  if (s.mediaCount === 0) {
    missing.push({ key: "source_media", label: FIELD_LABELS.source_media });
  }
  return missing;
}


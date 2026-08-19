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

/** A required field a create/edit form is still missing. `key` drives the
 *  in-form highlight; `label` is what `IncompleteFormNotice` lists. Shared by
 *  the geolocation + request validators so both feed the same
 *  notice + highlight plumbing. */
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

/** The one human label per field key: the single source both the validators
 *  (their `MissingField.label`) and the submit readiness tick-list read from, so
 *  a rename can't desync the two. */
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

/** How many secondary source links an event carries at most. Mirrors
 *  `models/event.MAX_SECONDARY_SOURCE_LINKS`: the form stops the analyst at the
 *  cap instead of letting the server 400 (`too_many_source_links`) after the
 *  media has uploaded. */
export const MAX_SECONDARY_SOURCE_LINKS = 10;

/** Page size for the owner Detections queue. Kept below the backend default
 *  (`per_page=20`, capped at 100) so the source-media previews on each row
 *  load faster. */
const DETECTIONS_PER_PAGE = 10;

/** How many detections one review session loads at once. The backend caps a list
 *  response at 100 rows whatever `per_page` asks for, so this is the whole
 *  queue for any realistic import; a longer queue is reviewed one batch at a
 *  time. Loaded once per session and stepped through locally, so a published
 *  row leaving the queue can't shift the position under the analyst. */
const DETECTIONS_REVIEW_QUEUE = 100;

/** The queue filter `GET /events/detections` accepts: the whole queue, the
 *  detections that clear the publish floor, or the ones that don't. Hand-written
 *  rather than generated for the same reason as `EventView`: the router takes
 *  `readiness` as a plain `str` so it can hand-build its 422, and codegen
 *  carries no union for it. Mirrors `services/events.DETECTION_READINESS`. */
export type DetectionReadiness = "all" | "ready" | "incomplete";

/** Shape of `GET /events/detections`: full-detail items (media + tags) so
 *  the queue renders the evidence and names what each detection is missing without
 *  a per-row round-trip. Mirrors the backend `PaginatedEventDetails`.
 *
 *  `total` counts the set `readiness` selected, so the page arithmetic
 *  describes what is being walked. `ready_total` and `incomplete_total` count
 *  the whole queue whatever the filter is, so the queue can state both figures
 *  under any filter and on any page. */
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

/** The queue a review pass steps through: one batch, newest first. */
export function detectionsReviewPath(): string {
  return detectionsPath(1, DETECTIONS_REVIEW_QUEUE);
}

/** Marks an edit URL as one step of a review pass over the detections queue.
 *  The edit page reads it to decide whether to place the detection in the queue;
 *  every hop of a pass carries it, so the walk survives a reload and the
 *  browser's Back. */
export const QUEUE_PARAM = "queue";

/** The owner's edit surface for one detection, optionally inside a review pass. */
export function detectionEditPath(id: string, inQueue = false): string {
  return `/events/${id}/edit${inQueue ? `?${QUEUE_PARAM}=1` : ""}`;
}

/** The two read views over the one `events` table: `located` (the catalogue,
 *  the map + default list) or `requested` (the open-call queue, ex `/requests`).
 *  See `docs/data-model.md` → `events`. */
export type EventView = "located" | "requested";

export interface EventListParams {
  view?: EventView;
  status?: EventStatus;
  tag?: string;
  author?: string;
  limit?: number;
  /** Cursor of the next page, from a `Link: rel="next"` header. */
  cursor?: string | null;
}

/** Build the `GET /events` query string for one lifecycle view. Defaults to
 *  `view=located`; the requested queue passes `view=requested`. The response
 *  is capped at 100 rows whatever `limit` asks for, so reading further means
 *  passing the `cursor` the previous page's `Link` header carried. */
export function eventListPath(params: EventListParams = {}): string {
  const search = new URLSearchParams();
  if (params.view) search.set("view", params.view);
  if (params.status) search.set("status", params.status);
  if (params.tag) search.set("tag", params.tag);
  if (params.author) search.set("author", params.author);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return `/events${qs ? `?${qs}` : ""}`;
}

/** The optional camera-position pair for a submit / geolocate call, ready to
 *  spread into the input. Both-or-neither: a lone half is dropped (so a
 *  half-typed pair doesn't 400), and a non-numeric pair clears it. Shared by the
 *  submit and edit forms so the both-or-neither rule can't drift. */
export function parseCaptureCoords(
  latStr: string,
  lngStr: string
): { capture_source_lat: number; capture_source_lng: number } | Record<string, never> {
  const lat = cleanNumber(latStr);
  const lng = cleanNumber(lngStr);
  if (lat === null || lng === null) return {};
  return { capture_source_lat: lat, capture_source_lng: lng };
}

/** The optional subject-coordinate guess a request may carry, ready to spread
 *  into the input. Same both-or-neither rule and strict parse as the camera
 *  point (`parseCaptureCoords`), so the two coordinate pairs on the submit form
 *  can't drift onto different validity rules. */
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

/**
 * The generalized fulfil / submit transition: `POST /events/{id}/geolocate`,
 * multipart, mirroring create. Moves a `requested` (request fulfilment) or
 * `detected` event to `geolocated`, which publishes it: the event becomes the
 * vouched record, and every later change to it, the evidence anchor included,
 * is a new version through `saveVersion`. On a `requested` event the backend transfers
 * ownership to the geolocator. The form posts the whole state; the server
 * writes it atomically. New media ride in `files`; existing media are dropped
 * via `remove_media_ids`. Only `detected_from_url` (the provenance anchor) and
 * `status` carry no field.
 */
export interface EventEditInput {
  title: string;
  lat: number;
  lng: number;
  /** Optional camera position (where the footage was shot from), distinct from
   *  the subject `lat` / `lng`. Both halves or neither; a lone half is a 400. */
  capture_source_lat?: number;
  capture_source_lng?: number;
  source_url: string;
  /** Optional snapshot of `source_url`, archived by the analyst while filling
   *  the form. Stored as the event's archived source by the same write, so a
   *  snapshot that isn't one of `source_url` fails the whole submit. */
  source_snapshot_url?: string;
  /** Optional mirrors of the same media, in the order the analyst listed them.
   *  Blank entries are dropped at assembly; the server normalizes the rest. */
  secondary_source_urls?: string[];
  /** Optional snapshot of each mirror, index-aligned with the list above and
   *  blank where that mirror was not archived. A mirror rots like the primary,
   *  so every declared link carries its own archived-copy field; a snapshot
   *  that isn't one of the mirror it sits beside fails the whole submit. */
  secondary_snapshot_urls?: string[];
  /** Optional ISO `YYYY-MM-DD`; omitted when the footage doesn't establish
   *  the date (reads as "Unknown"). */
  event_date?: string;
  /** Optional ISO `HH:MM`; empty / omitted clears it. */
  event_time?: string;
  /** ISO datetime (`YYYY-MM-DDTHH:MM`, UTC). Required on the publish paths: a
   *  post always has a time. Left empty on `saveVersion` the field is not
   *  posted at all, and the published row keeps the instant it holds. */
  source_posted_at: string;
  proof?: Record<string, unknown> | null;
  /** Replaces the tag set wholesale. */
  tag_ids: string[];
  /** Replaces the conflict set wholesale (the conflicts referential, separate
   *  from tags). */
  conflict_ids: string[];
  /** The author's declaration that the footage shows death, injury or human
   *  remains. Blurs the media behind an age confirmation for readers. */
  is_graphic?: boolean;
  /** Ids of existing media to drop. */
  remove_media_ids: string[];
  /** New source media to upload. */
  files: File[];
  /** The proof body's inline images, held locally while typing and uploaded
   *  here at publish. Matched to the proof doc's `placeholder://<filename>`
   *  srcs by filename; the server rewrites each src to the stored URL. */
  proof_files: File[];
}

/** The multipart fields every write path encodes identically: metadata,
 *  the optional camera point (both-or-neither), and the tag set. Factored out
 *  of `appendEventFormFields` and `createEventRequest` so the two paths can't
 *  drift on this shared subset. The paths differ only on the subject point
 *  (`lat`/`lng` required on geolocate, optional on a request), the
 *  source-media key, and `proof_files`, which each caller appends itself. */
function appendSharedEventFields(
  fd: FormData,
  input: {
    title: string;
    /** Optional on the version path alone, where an omitted field keeps the
     *  source the published row holds. */
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
  // Always sent, never conditional: the geolocate path posts the whole state,
  // so an omitted field would clear a flag the detection already carried.
  fd.append("is_graphic", String(input.is_graphic ?? false));
  if (input.source_url !== undefined) fd.append("source_url", input.source_url);
  // The archived copy of that source, when the analyst made one on the form.
  // Omitted rather than posted empty: the field is optional on all three paths.
  if (input.source_snapshot_url?.trim()) {
    fd.append("source_snapshot_url", input.source_snapshot_url.trim());
  }
  // One append per link, plus the archived copy pasted beside it: the backend
  // reads `secondary_source_urls` and `secondary_snapshot_urls` as repeated
  // form fields, not JSON blobs (unlike the id lists below, whose items are
  // opaque uuids), and pairs them by position. A row the analyst left blank is
  // dropped here so an untouched field never posts an empty entry, and its
  // snapshot goes with it, which is what keeps the two lists aligned across
  // the drop. The copy entry is posted even when empty, so position i on the
  // wire always names mirror i.
  const mirrors = input.secondary_source_urls ?? [];
  const mirrorCopies = input.secondary_snapshot_urls ?? [];
  mirrors.forEach((url, index) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    fd.append("secondary_source_urls", trimmed);
    fd.append("secondary_snapshot_urls", (mirrorCopies[index] ?? "").trim());
  });
  // Both-or-neither: only send the camera point when both halves are present,
  // matching the backend `_optional_point` contract (a lone half is a 400).
  if (input.capture_source_lat !== undefined && input.capture_source_lng !== undefined) {
    fd.append("capture_source_lat", String(input.capture_source_lat));
    fd.append("capture_source_lng", String(input.capture_source_lng));
  }
  if (input.event_time) fd.append("event_time", input.event_time);
  // Omitted rather than posted empty: on `save_version` an absent value keeps the
  // instant the published row holds, so posting "" would ask the server to tell
  // "blanked" from "untouched" on a field the form always renders. The publish
  // paths require the field and reject a submit that leaves it out.
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

/** Append the multipart fields every geolocation write posts. The source-media
 *  key differs by endpoint (create / request take a singular `file`, geolocate
 *  and the version path a plural `files` list for kept-plus-new), so the caller
 *  passes it. Builds on `appendSharedEventFields` and adds the always-present
 *  subject point, the optional `event_date`, the source media with the ids a
 *  swap drops, and the proof-body images. */
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
  // The other half of a source swap, on the two paths that edit an existing
  // row: the file above is the replacement, these are the rows it replaces.
  // A create has nothing to drop and never carries the key.
  if (input.remove_media_ids?.length) {
    fd.append("remove_media_ids", JSON.stringify(input.remove_media_ids));
  }
  // The proof body's inline images, matched to its `placeholder://` srcs by
  // filename server-side. Nothing hits S3 until this submit.
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

/** Create fields: the shared form minus geolocate's media-removal (a new
 *  event has no existing media to drop). */
export type EventCreateInput = Omit<EventEditInput, "remove_media_ids">;

/** How long a version's edit note may run. Mirrors
 *  `schemas/event.VERSION_NOTE_MAX_LENGTH`: the form stops at the cap instead of
 *  letting the server 422 a note someone just typed out. */
export const VERSION_NOTE_MAX_LEN = 280;

/**
 * Correcting a published event: the geolocate form, whole. The evidence anchor
 * is editable here too, `source_url` on its own field and the source media on
 * the `remove_media_ids` + `files` pair, under the same one-source cap: the
 * import sometimes picks the wrong media out of a multi-media post, and a
 * better copy of the same footage turns up later. The version this write files
 * carries the anchor it supersedes, so the record still shows what the claim
 * rested on. `source_url` is optional here alone: omitted, the published row
 * keeps the source it holds.
 */
export type EventVersionInput = Omit<EventEditInput, "source_url"> & {
  /** Optional: omitted or empty keeps the stored source URL, since a published
   *  row always carries one. The server reads an empty form value as an absent
   *  one, so posting the field blank is the same as leaving it out; a
   *  whitespace-only value is a 400. */
  source_url?: string;
  /** The editor's own words about this edit, stored on the version it
   *  supersedes. Optional, capped at `VERSION_NOTE_MAX_LEN`. */
  note?: string;
  /** Optional snapshot of `detected_from_url`, the post a machine detection
   *  came from. Only this endpoint takes it: the provenance link is immutable
   *  from the moment the detection exists, so the published row is where its
   *  copy is recorded. Archiving it is not a change to it, which is why an
   *  otherwise-locked field carries the paste. */
  detected_from_snapshot_url?: string;
};

/**
 * Save a correction to a published event: `POST /events/{id}/versions`
 * (multipart), owner-only and `geolocated`-only. The server files the
 * superseded state as a version and moves the row to the next `version_no`,
 * so the edit adds a version rather than overwriting the record.
 */
export function saveVersion(
  id: string,
  input: EventVersionInput
): Promise<EventDetail> {
  const fd = new FormData();
  appendEventFormFields(fd, input);
  if (input.note?.trim()) {
    fd.append("note", input.note.trim());
  }
  // The provenance link's copy, appended here rather than in the shared
  // assembler: this is the one endpoint that declares the field.
  if (input.detected_from_snapshot_url?.trim()) {
    fd.append("detected_from_snapshot_url", input.detected_from_snapshot_url.trim());
  }
  return apiFetch<EventDetail>(`/events/${id}/versions`, {
    method: "POST",
    body: fd,
  });
}

// ── Version history ───────────────────────────────────────────────────────
//
// The read side of a corrected record. `GET /events/{id}/versions` serves the
// superseded versions newest first and `GET /events/{id}/versions/{n}` serves
// one of them; the live row is the current version and is served by
// `GET /events/{id}` alone. Everything below turns those three payloads into
// what `/events/{id}/history` and `/events/{id}/vN` render.

/** One page of an event's history. `cursor` is the value the previous page's
 *  `Link: rel="next"` carried, `null` for the first page. */
export function eventVersionsPath(id: string, cursor: string | null): string {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return `/events/${id}/versions${query ? `?${query}` : ""}`;
}

/** One filed version by its number, the direct read behind a `/vN` address. */
export function eventVersionPath(id: string, versionNo: number): string {
  return `/events/${id}/versions/${versionNo}`;
}

/** Where one version of an event is read. The current version keeps the
 *  canonical `/events/{id}`, so this is only ever a past version's address. */
export function eventVersionHref(id: string, versionNo: number): string {
  return `/events/${id}/v${versionNo}`;
}

/** Where an event's version list is read. */
export function eventHistoryHref(id: string): string {
  return `/events/${id}/history`;
}

/**
 * Whether this row has been published, retraction included.
 *
 * A version only exists past publication (every other state is edited in
 * place), and retracting a published row keeps its history: the surfaces that
 * offer the history therefore ask this rather than `status === "geolocated"`,
 * which would drop the way into the record exactly when a reader most needs to
 * walk what the record used to claim.
 */
export function hasPublishedRecord(
  geo: Pick<EventDetail, "status" | "before_closed_status">
): boolean {
  return (
    geo.status === "geolocated" ||
    (geo.status === "closed" && geo.before_closed_status === "geolocated")
  );
}

/** The version number a `/events/{id}/vN` path segment names, or `null` when
 *  the segment is not one. `v0` and any other shape are `null`, so the route
 *  answers 404 rather than asking the API about a number no event carries. */
export function parseVersionSegment(segment: string): number | null {
  if (!/^v[1-9][0-9]*$/.test(segment)) return null;
  return Number(segment.slice(1));
}

/** The one human label per versioned field, in the order a changed-field list
 *  prints them. They are the names the event page already prints over the same
 *  values, so a reader recognises what moved without a second vocabulary. Keyed
 *  by the fields `services/versions.build_snapshot` files, since a field a
 *  version cannot carry is a field no diff can name. */
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

/** The archived copies an event view carries, keyed by the link each covers.
 *
 *  The read shape spreads them across three fields (the source, the provenance
 *  link, and one entry per mirror index-aligned with `secondary_source_urls`);
 *  this is the one walk that gathers them, so the version overlay, the
 *  changed-field list and the edit form read the same set. */
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

/** The archived copies one filed version held, keyed by the link each covers.
 *
 *  `services/versions.build_snapshot` files them, so a version renders the
 *  copies as they stood rather than today's. A snapshot with no `archives` key
 *  states nothing about them (a version filed before they were versioned, or a
 *  redacted one), so the live row's copies stand in: claiming the record had
 *  none would print an archival that never happened as a change. */
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
    if (original && url && (provider === "wayback" || provider === "archive_today")) {
      copies.set(original, { url, provider });
    }
  }
  return copies;
}

/**
 * One filed version as the shape every event surface already renders.
 *
 * The snapshot carries the fields an edit can move, the evidence anchor
 * included: `source_url` and `source_media` are what the record rested on at
 * that version, and the media fragment is the whole row shape, since the row
 * itself is gone once a later version replaced it (an event carries one source
 * media). The anchor is read off the snapshot alone, never off the live row:
 * every filed version names it, so standing the live row in would render the
 * media that replaced the anchor on the versions it replaced and hand the
 * changed-field list the same value on both sides of a swap. The row's identity
 * (id, owner, status, creation date) always comes from the current row, no edit
 * being able to move it. `version_no` is the version being read, so the page
 * prints which one it is.
 *
 * Two overlays are rebuilt rather than copied. The archived copies are the ones
 * this version held, and they are spread back over the three fields that carry
 * them by the link each covers rather than by position, so a mirror takes the
 * copy recorded for its own URL. A conflict is stored on the snapshot as its id
 * and name alone, so the referential row is used when the id still resolves and
 * the stored name stands in when it does not, which is what keeps a version
 * readable after a conflict is renamed or deleted.
 *
 * The snapshot arrives untyped (the backend declares it as a JSON object), so
 * every field is read defensively: a redacted version, whose snapshot is `{}`,
 * maps to the current row's immutables and empty content rather than throwing.
 * Callers render the redaction notice instead of this view.
 */
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
    // Derived from the same media, so a preview of this version shows the
    // footage it rested on rather than the one that replaced it.
    thumbnail: media[0] ?? null,
    archived_source: archivedByUrl.get(sourceUrl ?? "") ?? null,
    archived_detected_from: archivedByUrl.get(current.detected_from_url ?? "") ?? null,
    title: asString(snapshot.title, current.title),
    event_coords: asCoords(snapshot.event_coords),
    capture_source_coords: asCoords(snapshot.capture_source_coords),
    event_date: asNullableString(snapshot.event_date),
    event_time: asNullableString(snapshot.event_time),
    source_posted_at: asNullableString(snapshot.source_posted_at),
    // Ratcheted against the live row, the way the backend ratchets the column:
    // the media a version page renders is the live media, so a flag raised
    // after this version was filed still covers what the page shows. Only the
    // other direction is a version's own fact, a version filed while the flag
    // was already up.
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

/** Two instants are the same moment whatever their spelling: the snapshot and
 *  the live row serialise the same column through two paths, so a comparison
 *  on the strings would report a change on `+00:00` against `Z`. An
 *  unparseable value falls back to the string it is. */
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

/** Two clock times are the same time to the minute, which is the precision the
 *  field carries: the API serves `HH:MM:SS` and the form's `<input type="time">`
 *  holds `HH:MM`, so a raw string comparison would call an untouched field
 *  changed. */
const sameTime = (a: string | null, b: string | null): boolean =>
  (a?.slice(0, 5) ?? null) === (b?.slice(0, 5) ?? null);

/** Two unordered relationships hold the same members. Tags and conflicts are
 *  sets the API serves in whatever order it read them, so a position-sensitive
 *  comparison would announce a changed field on an edit that touched neither. */
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  sameList([...a].sort(), [...b].sort());

/** One version's archived copies as comparable pairs: which link, which
 *  snapshot. The provider is inferred from the snapshot's host, so the pair is
 *  the whole fact; the set is unordered, since the copies are keyed by link. */
const archivedPairs = (view: EventDetail): string[] =>
  [...archivedCopies(view)].map(([original, copy]) => `${original} ${copy.url}`);

/**
 * The versioned fields that differ between one version and the one before it,
 * as the labels a history row prints ("Title, Coordinates, Proof").
 *
 * Computed on the client from two adjacent versions, since the API serves what
 * each version held rather than what an edit did. Both arguments are the view
 * shape, so the current row and a mapped snapshot compare identically.
 *
 * Tags and conflicts compare by identity rather than by name: a referential row
 * renamed under a published event changes no version. They also compare as
 * sets, the relationship being unordered. The inline images are not their own
 * entry: they live inside the proof document, so a body whose images moved is a
 * body that moved, and naming both would print two labels for one edit. The
 * archived copies compare as the set of (link, snapshot) pairs the version
 * carries, which is what the reader sees beside each link, so recording a copy
 * is announced as *Archived copies* the way any other correction is announced.
 */
export function changedFields(version: EventDetail, previous: EventDetail): string[] {
  const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);
  const changed: string[] = [];
  const flag = (label: string, differs: boolean) => {
    if (differs) changed.push(label);
  };
  flag(VERSION_FIELD_LABELS.title, version.title !== previous.title);
  flag(VERSION_FIELD_LABELS.source_url, version.source_url !== previous.source_url);
  // By identity: a swap is a new row, and the media a version rendered is named
  // by the snapshot that filed it.
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

/** The editable state the edit form holds, as the strings its inputs carry.
 *
 *  Spelled out per field rather than reusing `EventVersionInput`, because the
 *  check runs on what is typed rather than on what would be posted: the coordinate
 *  inputs are still strings, and the two snapshot pastes are what the analyst
 *  archived rather than what the row stores. */
export interface EventVersionFormState {
  title: string;
  /** The source URL as the input holds it. Blank keeps the stored one, which is
   *  what the endpoint does with an omitted field. */
  sourceUrl: string;
  /** Whether the form stages a source-media swap: a stored row marked for
   *  removal, or a file queued for upload. Either moves the anchor, and neither
   *  can be compared as a value, the upload having no URL until it lands. */
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

/**
 * Whether saving this form would file a version that differs from the one on
 * screen.
 *
 * The form posts the whole editable state, so a save with nothing touched would
 * otherwise ask the server to mint a version whose changed-field list is empty.
 * The check runs on the client so that save costs no request, and the server
 * refuses the same edit with `nothing_changed`, which is the authority: the row
 * may have moved under a form that has been open a while.
 *
 * The comparison is `changedFields` itself, over a candidate assembled from the
 * form state, so the two cannot come to disagree about which fields a version
 * carries. Two legs are computed here instead. The archived copies: a paste is
 * a change only where it differs from the copy that link already holds, and
 * spreading the pastes back over the three fields `archivedCopies` reads would
 * have to invent a provider for each, which nothing compares. And the source
 * media: a staged swap is a change by construction, since a file queued for
 * upload has no id to compare against the row's.
 */
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
    // Blank keeps the stored source, the way an omitted field does server side.
    source_url: state.sourceUrl.trim() || geo.source_url,
    event_coords: coordsOf(state.lat, state.lng),
    capture_source_coords: coordsOf(state.captureLat, state.captureLng),
    event_date: state.eventDate || null,
    event_time: state.eventTime || null,
    // Compared at the input's own precision, which is what the save posts. The
    // datetime input stops at the minute, so a field still holding what the row
    // seeded it with is untouched however many seconds the column carries, and
    // the save omits it rather than truncating the stored instant. A blanked
    // field keeps the row's value too, the way the endpoint reads an absent one.
    // Only a value the analyst actually changed is a new instant, and the input
    // is a UTC wall clock, which is what the `Z` names.
    source_posted_at:
      state.sourcePostedAt &&
      state.sourcePostedAt !== toDatetimeLocalUTC(geo.source_posted_at)
        ? `${state.sourcePostedAt}Z`
        : geo.source_posted_at,
    // Ratcheted, as the server ratchets it: a cleared switch on a flagged row
    // changes nothing.
    is_graphic: geo.is_graphic || state.isGraphic,
    secondary_source_urls: mirrors,
    // Realigned with the mirrors above, since `archivedCopies` pairs the two
    // lists by position.
    archived_secondary_sources: mirrors.map((url) => stored.get(url) ?? null),
    // Only the ids are compared, so the rest of each row is the loaded one.
    tags: state.tagIds.map((id) => ({ id })) as EventDetail["tags"],
    conflicts: state.conflictIds.map((id) => ({ id })) as EventDetail["conflicts"],
    proof: state.proof,
  };
  return changedFields(candidate, geo).length > 0;
}

/** What the edit form says when a save would file a version identical to the one
 *  on screen.
 *
 *  Word for word the sentence `services/events.save_version` raises with
 *  `nothing_changed`, so the client-side check (which spends no request) and the
 *  server's refusal read the same. Which is also why the form prefers the
 *  server's own message when it has one: the row may have moved under a form
 *  that has been open a while, and the server names the version it actually
 *  compared against. */
export const nothingChangedMessage = (versionNo: number): string =>
  `Nothing changed since version ${versionNo}.`;

/** One version of an event, as the history list and the version page read it. */
export interface EventVersionEntry {
  /** Which version this is. `1` is the record as it was published. */
  number: number;
  /** True for the live row, the one `/events/{id}` serves. */
  current: boolean;
  /** The event as it stood at this version, or `null` when the version was
   *  redacted and carries no content to render. */
  view: EventDetail | null;
  /** Who produced this version, and when. `null` when the row that carries
   *  that byline and date could not be read, so neither is stated. */
  editor: EventDetail["owner"] | null;
  createdAt: string | null;
  /** That editor's own words about the edit, `null` when they left none. */
  note: string | null;
  /** Whether an admin blanked this version's content. */
  redacted: boolean;
  /** The fields this version changed against the one before it, empty when the
   *  edit moved none of them. `null` when the two versions cannot be compared
   *  at all: version 1 had nothing before it, and a redacted version on either
   *  side carries no content to compare. */
  changed: string[] | null;
}

/** The version rows one version is assembled from.
 *
 *  `own` holds this version's content, and is absent for the current version,
 *  which is the live row rather than a filed one. `producedBy` holds the edit
 *  that **produced** this version, which the API files on the version that edit
 *  superseded, so it is the row numbered one lower. `previous` is the view of
 *  that lower version, the base the changed-field list is computed against. */
export interface EventVersionEntryRows {
  own?: EventVersion | null;
  producedBy?: EventVersion | null;
  previous?: EventDetail | null;
}

/**
 * One version of an event, from the rows that describe it.
 *
 * A version is described by the edit that **produced** it, the way a page
 * history reads: who made that edit, when, their note about it, and the fields
 * it moved. The API files the two halves of that apart, because a version row
 * carries the content of the version it holds alongside the byline, date and
 * note of the edit that superseded it. Version `n` therefore takes its content
 * from row `n` and its authorship from row `n - 1`; version 1, which no edit
 * produced, takes the analyst who published the record and `geolocated_at`, the
 * date they published it. `created_at` is the submission or detection stamp,
 * which is when the record was opened rather than when version 1 came to be.
 *
 * A version above 1 whose producing row is missing states neither byline nor
 * date: the edit that made it is what the reader is being told about, and an
 * unread row is not a reason to credit the publication instead.
 */
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

/**
 * The event's versions, newest first, assembled from the current row and the
 * history rows loaded so far.
 *
 * `hasMore` is the walk's own answer about whether the history has further
 * pages. While it does, the oldest row loaded is authorship for the version
 * above it rather than a version of its own, so it is held back until the page
 * that completes it arrives: a row is either whole or absent, never a version
 * number with no editor beside it.
 */
export function eventVersions(
  current: EventDetail,
  rows: EventVersion[],
  hasMore = false
): EventVersionEntry[] {
  const byNumber = new Map(rows.map((row) => [row.version_no, row]));
  // `+ 1`: while the walk has pages, the lowest row loaded is authorship for
  // the version above it and not yet a version of its own, since its own
  // authorship sits on the row below, which the next page carries. So the walk
  // stops one version above it. A finished walk reaches version 1, which no
  // edit produced.
  const oldest = hasMore && rows.length > 0 ? Math.min(...byNumber.keys()) + 1 : 1;

  // The version below is built as its own row too, so this is the diff base
  // only: the content it reads is the same snapshot either way.
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

/**
 * Create a geolocation: `POST /events` (multipart), returning the new id for the
 * redirect. Shares the form assembly with `geolocateEvent`; the source media is
 * the one field that differs (create sends a singular `file`, geolocate a plural
 * `files` list), so the assembler takes the key.
 */
export function createEvent(input: EventCreateInput): Promise<{ id: string }> {
  const fd = new FormData();
  appendEventFormFields(fd, input, "file");
  return apiFetch<{ id: string }>("/events", {
    method: "POST",
    body: fd,
  });
}

/**
 * Open a request (a `requested` event): `POST
 * /events/requests` (multipart). An approximate coordinate guess is optional
 * (both `lat`/`lng` or neither); `event_date` is optional (often unknown at
 * request time); one source media file is required.
 */
export interface EventRequestInput {
  title: string;
  source_url: string;
  /** Optional snapshot of `source_url`, same contract as a geolocation's: the
   *  submit form posts either shape, so a paste made there is kept on both. */
  source_snapshot_url?: string;
  /** Optional mirrors, same contract as a geolocation's (see `EventEditInput`). */
  secondary_source_urls?: string[];
  /** Optional snapshot of each mirror, index-aligned with the list above, same
   *  contract as a geolocation's. */
  secondary_snapshot_urls?: string[];
  /** In-progress proof (Tiptap JSON), mirroring a geolocation's `proof`. */
  proof?: Record<string, unknown> | null;
  /** Optional approximate guess: both halves or neither. */
  lat?: number;
  lng?: number;
  /** Optional camera position (where the footage was shot from), if known.
   *  Both halves or neither. Distinct from the subject guess above. */
  capture_source_lat?: number;
  capture_source_lng?: number;
  /** Optional, ISO YYYY-MM-DD: when the event happened. */
  event_date?: string;
  /** Optional, ISO HH:MM: event time-of-day (UTC). */
  event_time?: string;
  /** ISO datetime (`YYYY-MM-DDTHH:MM`, UTC): when the source posted. Required. */
  source_posted_at: string;
  /** Same author declaration a geolocation carries (see `EventEditInput`). */
  is_graphic?: boolean;
  tag_ids?: string[];
  conflict_ids?: string[];
  files: File[];
  /** The proof body's inline images, held locally while typing and uploaded
   *  here at publish (matched to the doc's `placeholder://` srcs). Optional on a
   *  request: it may be work started but not finished, or a blank call. */
  proof_files: File[];
}

export function createEventRequest(input: EventRequestInput): Promise<EventDetail> {
  const fd = new FormData();
  // Shared metadata + camera point + tags. A request's deltas from a
  // geolocation: the subject point is optional (each half guarded, not
  // both-or-neither), `event_date` is optional, and the source rides under the
  // singular `file` key. Proof images are optional (no image floor).
  appendSharedEventFields(fd, input);
  if (input.lat !== undefined) fd.append("lat", String(input.lat));
  if (input.lng !== undefined) fd.append("lng", String(input.lng));
  if (input.event_date) {
    fd.append("event_date", input.event_date);
  }
  for (const file of input.files) {
    fd.append("file", file);
  }
  for (const file of input.proof_files) {
    fd.append("proof_files", file);
  }
  return apiFetch<EventDetail>("/events/requests", {
    method: "POST",
    body: fd,
  });
}

/**
 * Import one of your own X posts: `POST /events/import-from-tweet` runs the
 * detection engine over it and answers with the detections it created, updated or
 * left alone, plus the warnings review has to answer.
 */
export function importFromPost(url: string): Promise<TweetImportOutcome> {
  return apiFetch<TweetImportOutcome>("/events/import-from-tweet", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

/**
 * Step 1 of the archive import: `POST /events/import-archive/presign` mints
 * the staging key and the presigned direct-to-storage upload target (S3's
 * POST policy in prod, the dev upload endpoint locally, one shape).
 */
export function presignArchiveUpload(): Promise<ArchiveImportPresign> {
  return apiFetch<ArchiveImportPresign>("/events/import-archive/presign", {
    method: "POST",
  });
}

/** The upload leg failed in transit (network drop, an expired presign):
 *  nothing is staged or enqueued, so a retry of the same import is always
 *  safe. Distinct from an enqueue `ApiError`, and from the over-cap reject,
 *  which is terminal and carries `archive_too_large` instead. */
export class ArchiveUploadError extends Error {
  constructor() {
    super("The upload didn't complete. Check your connection and try again.");
    this.name = "ArchiveUploadError";
  }
}

/** The `detail` prefixes the dev upload endpoint answers 413 with
 *  (`backend/app/main.py`): the route's own streaming size guard, and the
 *  body-size middleware sitting ahead of it, whose message carries the byte
 *  cap after this prefix. */
const DEV_UPLOAD_TOO_LARGE_DETAILS = [
  "Upload exceeds the size guard",
  "Request body too large",
];

/** Whether a 413 came from our own dev upload endpoint rather than from
 *  something in between. FastAPI answers `{"detail": "…"}`; anything that
 *  isn't that JSON shape with one of the known messages is an intermediary. */
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

/** Classify a non-2xx from the storage POST. An over-cap body is terminal, so
 *  it must not surface as the retryable transit message: S3 rejects the POST
 *  policy's `content-length-range` with a 400 whose XML body carries
 *  `EntityTooLarge`, and the dev upload endpoint answers 413 on the same
 *  condition. The 413 is matched on that endpoint's own body, never on the
 *  status alone: a proxy between the analyst and storage can 413 a body that
 *  is under the cap (which the strip just proved), and calling that archive
 *  too large would steer them away from a retry that works. Everything else
 *  is transit. */
function uploadFailure(status: number, body: string): Error {
  const tooLarge =
    body.includes("<Code>EntityTooLarge</Code>") ||
    (status === 413 && isDevUploadTooLarge(body));
  return tooLarge ? archiveTooLarge() : new ArchiveUploadError();
}

/**
 * Step 2: POST the stripped zip straight to storage (never through the API).
 * XHR rather than fetch for its upload progress events; `fields` go ahead of
 * the file part (S3 ignores fields after it), and no credentials ride along
 * (the presigned policy is the authorization). `onProgress` gets the raw
 * uploaded/total byte counts (the multipart envelope included), so the caller
 * can render real numbers, not just a fraction.
 */
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

/**
 * Step 3: `POST /events/import-archive` (JSON) verifies the staged object and
 * enqueues the backfill. Only the allowlisted entries (`tweets.js` +
 * `tweets_media/`) are ever extracted server-side. Returns the `queued` job
 * (202): the worker service runs the import (every row lands `detected` for
 * the caller to submit) and emails the outcome; poll the job for the counts.
 * `postEstimate` is the strip's cosmetic volume hint for the queued display.
 */
export function enqueueArchiveImport(
  uploadKey: string,
  postEstimate: number
): Promise<ArchiveImportJob> {
  return apiFetch<ArchiveImportJob>("/events/import-archive", {
    method: "POST",
    body: JSON.stringify({ upload_key: uploadKey, post_estimate: postEstimate }),
  });
}

/** One import job, owner-only: `GET /events/import-archive/{job_id}`. */
export function getImportJob(jobId: string): Promise<ArchiveImportJob> {
  return apiFetch<ArchiveImportJob>(`/events/import-archive/${jobId}`);
}

/** The poll gave up (transient errors piled up, or the run outlived the
 *  window) while the job itself may still land: "we lost sight of it", never
 *  "it failed". The completion email stays the durable signal. */
export class ImportPollLost extends Error {}

/**
 * Poll `jobId` until the worker lands it (`done` | `failed`); resolve with the
 * terminal job. Resolution can take minutes on a large archive: the completion
 * email is the durable signal, this keeps the upload page live while it's open.
 * A transient poll failure (network blip, a stray 429) is retried, not
 * surfaced as an import failure; only `maxErrors` consecutive misses or the
 * overall `timeoutMs` give up, with `ImportPollLost`.
 */
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
    /** Fires with every successfully polled snapshot (queued / running
     *  progress included), so the page can render live progress. */
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

/**
 * What stops one detection from publishing, as human labels. Empty means
 * the row carries the whole evidence floor and only needs the two human choices
 * (conflict, capture source) to publish: the "ready" state the queue badges.
 *
 * Mirrors the server floor in `services/events._publish_detection`, and only that:
 * it judges evidence the machine either found or didn't, so the form-level
 * requirements a submit adds (a title, the source post time) are not part of
 * it. Computed on the queue payload the detections list already carries, so the
 * list can name what a row is missing before anything is posted; the server
 * stays the authority.
 *
 * The review flow judges its live, edited state against the fuller
 * `missingEventFields` (the geolocate floor it publishes through). The two
 * agree on which detections are publishable: a source-less detection carries neither
 * `source_url` nor `source_posted_at`, and the title a review always carries.
 *
 * Same rule, third expression: `services/events.detection_ready_predicate` is the
 * SQL the queue's `readiness` filter pages on. The queue labels each row from
 * here and asks the server which rows to show, so the two must agree. Both are
 * held to one table of detection shapes: `backend/tests/events/_readiness_cases.py`
 * on the server side, its mirror in `events.test.ts` here.
 */
export function batchCompletionBlockers(geo: {
  event_coords: unknown | null;
  source_url: string | null;
  proof: Record<string, unknown> | null;
  media: readonly Pick<Media, "role">[];
}): string[] {
  // Listed in the server's own check order, so the labels read in the order the
  // API would have reported them had the row been posted.
  const missing: string[] = [];
  if (!geo.source_url?.trim()) missing.push(FIELD_LABELS.source_url);
  if (!geo.event_coords) missing.push(FIELD_LABELS.coordinates);
  // The floor is a `source` media row, not any media row. `EventRead` only
  // serializes `source` rows today, so the predicate is stricter than the
  // payload needs; it is written against the rule rather than the projection,
  // and `Pick<Media, "role">` makes `tsc` hold it there.
  if (!geo.media.some((m) => m.role === "source")) missing.push(FIELD_LABELS.source_media);
  // The proof-image leg: already satisfied when the import carried annotation
  // media, and the one the queue most often has to flag.
  if (!geo.proof || !proofHasImage(geo.proof)) missing.push(FIELD_LABELS.proof_image);
  return missing;
}

/** Close an event: withdraw a request, reject a detection, or retract a
 *  published geolocation (owner-only). `POST /events/{id}/close`. The reason
 *  stays publicly visible next to the closed badge, so it's required, and
 *  closing is terminal: the owner has no un-close. */
export function closeEvent(id: string, closeReason: string): Promise<EventDetail> {
  return apiFetch<EventDetail>(`/events/${id}/close`, {
    method: "POST",
    body: JSON.stringify({ close_reason: closeReason }),
  });
}

/** The five buckets a report picks from, and the body of the call. Aliased
 *  from the generated spec rather than restated, so a backend rename fails
 *  `tsc` instead of drifting. */
export type ContentReportReason =
  components["schemas"]["ContentReportCreate"]["reason"];

/** One report as the admin queue reads it: the bucket, the reporter's own
 *  words, and the verdict once one lands (`resolved_at === null` is the open
 *  test on the wire). */
export type ContentReport = components["schemas"]["ContentReportRead"];

/** How long the reporter's own words may run. Mirrors
 *  `schemas/report.DETAILS_MAX_LENGTH`: the form stops at the cap instead of
 *  letting the server 422 a report someone just typed out. */
export const REPORT_DETAILS_MAX_LEN = 2000;

/**
 * The human label per report bucket, in the reporter's own register: the
 * report form offers them and the admin queue reads them back, so one map
 * serves both and the two surfaces cannot name the same bucket differently.
 * Keyed by the generated union, so a new backend reason fails `tsc` here
 * instead of rendering as a raw enum value.
 */
export const REPORT_REASON_LABELS: Record<ContentReportReason, string> = {
  illegal_content: "Illegal content",
  graphic_not_flagged: "Graphic content, not flagged",
  copyright: "Copyright",
  privacy: "Privacy",
  other: "Something else",
};

/**
 * Report an event: `POST /events/{id}/report`. Open to anyone, signed in or
 * not: the people who most need to flag illegal or mislabelled footage are the
 * least likely to hold an account here. `apiFetch` omits the CSRF header when
 * no session cookie is present, so the same call works logged out; the backend
 * caps it per IP.
 */
export function reportEvent(
  id: string,
  body: components["schemas"]["ContentReportCreate"]
): Promise<ContentReport> {
  return apiFetch<ContentReport>(`/events/${id}/report`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** The editable state a geolocation create/edit form validates before it lets
 *  the analyst submit or validate. Strings are the raw input values. */
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
  /** Require >=1 source media. False when a request supplies the media.
   *  Default true. */
  requireMedia?: boolean;
  /** Require the conflict + capture-source tag floor. Default true. */
  requireTags?: boolean;
  /** Require the source post time. Default true, which is what publishing
   *  asks for (`POST /events/{id}/geolocate` declares the field required).
   *  False on a version: a detection whose source post time was never
   *  resolved publishes through the batch completion with the column NULL, and
   *  `POST /events/{id}/versions` takes the field as optional to match, so
   *  flagging it here would block an edit the server accepts. */
  requireSourcePostedAt?: boolean;
}

/**
 * Every still-unmet required field for a geolocation, as `{key, label}` for
 * `IncompleteFormNotice` (the labels) and the in-form highlight (the keys): the
 * whole list at once, not the first miss. Drives the create submit form and the
 * detection submit form. Coordinate, media, and tag rules mirror the backend;
 * keep them in step with the server submit check. Proof must carry an image
 * (`proofHasImage`):
 * a geolocation's proof is a source ↔ satellite cross-reference, so text alone
 * can't be audited.
 */
export function missingEventFields(
  s: EventFieldsState,
  {
    requireMedia = true,
    requireTags = true,
    requireSourcePostedAt = true,
  }: EventFieldsOptions = {}
): MissingField[] {
  // Same strict parse as the camera point (`cleanNumber`): a partially numeric
  // coordinate (`"48.85abc"`) reads as missing rather than silently truncating
  // to 48.85 at publish, so the readiness gate matches what actually posts.
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
  // Proof must exist *and* contain an image. "Proof" (none at all) and "Proof
  // image" (text-only) are distinct misses so the notice says which.
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

/**
 * Every still-unmet required field for a request, as human labels
 * for `IncompleteFormNotice`. A request is an unfinished geolocation, so its
 * floor is a subset of the geolocation one (no coordinates, dates, proof, or
 * tags), just enough to be actionable: a title, the source, and the footage.
 * Mirrors the server `POST /events/requests` requirements.
 */
export function missingEventRequestFields(s: {
  title: string;
  sourceUrl: string;
  sourcePostedAt: string;
  mediaCount: number;
}): MissingField[] {
  const missing: MissingField[] = [];
  if (!s.title.trim()) missing.push({ key: "title", label: FIELD_LABELS.title });
  if (!s.sourceUrl.trim()) missing.push({ key: "source_url", label: FIELD_LABELS.source_url });
  if (!s.sourcePostedAt) {
    missing.push({ key: "source_posted_at", label: FIELD_LABELS.source_posted_at });
  }
  if (s.mediaCount === 0) {
    missing.push({ key: "source_media", label: FIELD_LABELS.source_media });
  }
  return missing;
}


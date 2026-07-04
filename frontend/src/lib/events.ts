import { apiFetch } from "./api";
import { LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN } from "./coordinates";
import { proofHasImage } from "./proof";
import type {
  ArchiveImportResult,
  EventDetail,
  EventStatus,
  TagCategory,
} from "@/types";

/** A required field a create/edit form is still missing. `key` drives the
 *  in-form highlight; `label` is what `IncompleteFormNotice` lists. Shared by
 *  the geolocation + request (ex-request) validators so both feed the same
 *  notice + highlight plumbing. */
export type MissingFieldKey =
  | "title"
  | "coordinates"
  | "source_url"
  | "event_date"
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

/** Whether a row's source renders as the inert "synthetic" placeholder instead
 *  of its real link. Demo rows carry a non-resolving `source_url`, so it's
 *  hidden. A `detected` row is the exception: its source IS its provenance post
 *  (the imported tweet), a realistic link worth showing even in demo data. */
export function sourceIsSynthetic(g: {
  is_demo: boolean;
  status: EventStatus;
}): boolean {
  return g.is_demo && g.status !== "detected";
}

/** Page size for the owner Detections queue. Matches the backend default
 *  (`per_page=20`, capped at 100). */
const DETECTIONS_PER_PAGE = 20;

/** Shape of `GET /events/detections`: full-detail items (media + tags) so
 *  the queue renders the evidence and computes submit-readiness without a
 *  per-row round-trip. Mirrors the backend `PaginatedEventDetails`. */
export interface PaginatedEventDetails {
  items: EventDetail[];
  total: number;
  page: number;
  per_page: number;
}

export function detectionsPath(page = 1, perPage = DETECTIONS_PER_PAGE): string {
  return `/events/detections?page=${page}&per_page=${perPage}`;
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
}

/** Build the `GET /events` query string for one lifecycle view. Defaults to
 *  `view=located`; the requested (ex-request) queue passes `view=requested`. */
export function eventListPath(params: EventListParams = {}): string {
  const search = new URLSearchParams();
  if (params.view) search.set("view", params.view);
  if (params.status) search.set("status", params.status);
  if (params.tag) search.set("tag", params.tag);
  if (params.author) search.set("author", params.author);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
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

/** Parse a whole string as a finite number, or `null`. Unlike `parseFloat`,
 *  this rejects partially-numeric input (`"50.1abc"`), so a malformed pair
 *  clears the camera coords rather than storing a truncated value. Blank /
 *  whitespace-only reads as absent (`null`), preserving both-or-neither. */
function cleanNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function getEvent(id: string): Promise<EventDetail> {
  return apiFetch<EventDetail>(`/events/${id}`);
}

export function deleteEvent(id: string): Promise<void> {
  return apiFetch<void>(`/events/${id}`, { method: "DELETE" });
}

/**
 * The generalized fulfil / submit transition: `POST /events/{id}/geolocate`,
 * multipart, mirroring create. Moves a `requested` (request fulfilment) or
 * `detected` event to `geolocated` (frozen); on a `requested` event the backend
 * transfers ownership to the geolocator. The form posts the whole state; the
 * server writes it atomically. New media ride in `files`; existing media are
 * dropped via `remove_media_ids`. Only `detected_from_url` (the provenance
 * anchor) and `status` carry no field.
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
  /** ISO `YYYY-MM-DD`. */
  event_date: string;
  /** Optional ISO `HH:MM`; empty / omitted clears it. */
  event_time?: string;
  /** ISO datetime (`YYYY-MM-DDTHH:MM`, UTC). Required: a post always has a time. */
  source_posted_at: string;
  proof?: Record<string, unknown> | null;
  /** Replaces the tag set wholesale. */
  tag_ids: string[];
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
 *  (`lat`/`lng` required on geolocate, optional on a request), `event_date`
 *  (required vs optional), the source-media key, and `proof_files`, which each
 *  caller appends itself. */
function appendSharedEventFields(
  fd: FormData,
  input: {
    title: string;
    source_url: string;
    source_posted_at: string;
    proof?: Record<string, unknown> | null;
    capture_source_lat?: number;
    capture_source_lng?: number;
    event_time?: string;
    tag_ids?: string[];
  }
): void {
  fd.append("title", input.title);
  fd.append("source_url", input.source_url);
  // Both-or-neither: only send the camera point when both halves are present,
  // matching the backend `_optional_point` contract (a lone half is a 400).
  if (input.capture_source_lat !== undefined && input.capture_source_lng !== undefined) {
    fd.append("capture_source_lat", String(input.capture_source_lat));
    fd.append("capture_source_lng", String(input.capture_source_lng));
  }
  if (input.event_time) fd.append("event_time", input.event_time);
  fd.append("source_posted_at", input.source_posted_at);
  if (input.proof) fd.append("proof", JSON.stringify(input.proof));
  if (input.tag_ids && input.tag_ids.length > 0) {
    fd.append("tag_ids", JSON.stringify(input.tag_ids));
  }
}

/** Append the multipart fields shared by create + geolocate: every field
 *  except geolocate's `remove_media_ids`. The source-media key differs by
 *  endpoint (create / request take a singular `file`, geolocate a plural
 *  `files` list for kept-plus-new), so the caller passes it. Builds on
 *  `appendSharedEventFields` and adds the always-present subject point,
 *  `event_date`, the source media, and the proof-body images. */
function appendEventFormFields(
  fd: FormData,
  input: Omit<EventEditInput, "remove_media_ids">,
  sourceKey: "file" | "files" = "files"
): void {
  appendSharedEventFields(fd, input);
  fd.append("lat", String(input.lat));
  fd.append("lng", String(input.lng));
  fd.append("event_date", input.event_date);
  for (const file of input.files) {
    fd.append(sourceKey, file);
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
  if (input.remove_media_ids.length > 0) {
    fd.append("remove_media_ids", JSON.stringify(input.remove_media_ids));
  }
  return apiFetch<EventDetail>(`/events/${id}/geolocate`, {
    method: "POST",
    body: fd,
  });
}

/** Create fields: the shared form minus geolocate's media-removal (a new
 *  event has no existing media to drop). */
export type EventCreateInput = Omit<EventEditInput, "remove_media_ids">;

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
 * Open a request (a `requested` event, yesterday's request): `POST
 * /events/requests` (multipart). An approximate coordinate guess is optional
 * (both `lat`/`lng` or neither); `event_date` is optional (often unknown at
 * request time); one source media file is required.
 */
export interface EventRequestInput {
  title: string;
  source_url: string;
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
  tag_ids?: string[];
  files: File[];
}

export function createEventRequest(input: EventRequestInput): Promise<EventDetail> {
  const fd = new FormData();
  // Shared metadata + camera point + tags. A request's deltas from a
  // geolocation: the subject point is optional (each half guarded, not
  // both-or-neither), `event_date` is optional, the source rides under the
  // singular `file` key, and there are no `proof_files`.
  appendSharedEventFields(fd, input);
  if (input.lat !== undefined) fd.append("lat", String(input.lat));
  if (input.lng !== undefined) fd.append("lng", String(input.lng));
  if (input.event_date) {
    fd.append("event_date", input.event_date);
  }
  for (const file of input.files) {
    fd.append("file", file);
  }
  return apiFetch<EventDetail>("/events/requests", {
    method: "POST",
    body: fd,
  });
}

/**
 * Backfill the caller's profile from their X "Download your data" zip:
 * `POST /events/import-archive` (multipart). Only the allowlisted entries
 * (`tweets.js` + `tweets_media/`) are read server-side; the rest of the export
 * is never extracted. Every row lands `detected` for the caller to submit.
 */
export function importArchive(file: File): Promise<ArchiveImportResult> {
  const fd = new FormData();
  fd.append("file", file);
  return apiFetch<ArchiveImportResult>("/events/import-archive", {
    method: "POST",
    body: fd,
  });
}

/** Close an event: withdraw a request or reject a detection (owner-only).
 *  `POST /events/{id}/close`. The reason stays publicly visible next to the
 *  closed badge, so it's required. */
export function closeEvent(id: string, closeReason: string): Promise<EventDetail> {
  return apiFetch<EventDetail>(`/events/${id}/close`, {
    method: "POST",
    body: JSON.stringify({ close_reason: closeReason }),
  });
}

/** Caller joins the "I'm working on this" set. Idempotent: re-signalling
 *  is a 204 no-op, not an error. `POST /events/{id}/investigate`. */
export function investigateEvent(id: string): Promise<void> {
  return apiFetch<void>(`/events/${id}/investigate`, { method: "POST" });
}

/** Caller leaves the working set. No-op if caller wasn't signalling.
 *  `DELETE /events/{id}/investigate`. */
export function uninvestigateEvent(id: string): Promise<void> {
  return apiFetch<void>(`/events/${id}/investigate`, { method: "DELETE" });
}

export interface SubmitReadiness {
  isReady: boolean;
  /** Submit-floor fields still missing, the labels shown in the queue card's
   *  readiness line. Empty when ready. */
  missing: string[];
}

/**
 * Whether a `detected` row would pass the **Submit** gate, computed client-side
 * so the Detections queue shows the owner exactly what's left before they open
 * it. Delegates to `missingEventFields` (requireMedia + requireTags), the
 * same check the Submit button makes, so the readiness line can never drift from
 * what submitting actually enforces. (The backend floor is the narrower media +
 * `conflict` + `capture_source` tags; the form adds the core fields and a proof
 * image on top, see `missingEventFields`.)
 */
export function submitReadiness(geo: {
  title: string;
  lat: number;
  lng: number;
  source_url: string;
  event_date: string;
  source_posted_at: string;
  proof: Record<string, unknown> | null;
  media: readonly unknown[];
  tags: readonly { category: TagCategory }[];
}): SubmitReadiness {
  const missing = missingEventFields(
    {
      title: geo.title,
      lat: String(geo.lat),
      lng: String(geo.lng),
      sourceUrl: geo.source_url,
      eventDate: geo.event_date,
      sourcePostedAt: geo.source_posted_at,
      proof: geo.proof,
      mediaCount: geo.media.length,
      hasConflictTag: geo.tags.some((t) => t.category === "conflict"),
      hasCaptureSourceTag: geo.tags.some((t) => t.category === "capture_source"),
    },
    { requireMedia: true, requireTags: true }
  ).map((m) => m.label);

  return { isReady: missing.length === 0, missing };
}

/** The editable state a geolocation create/edit form validates before it lets
 *  the analyst submit or validate. Strings are the raw input values. */
export interface EventFieldsState {
  title: string;
  lat: string;
  lng: string;
  sourceUrl: string;
  eventDate: string;
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
}

/**
 * Every still-unmet required field for a geolocation, as `{key, label}` for
 * `IncompleteFormNotice` (the labels) and the in-form highlight (the keys): the
 * whole list at once, not the first miss. Drives the create submit form and the
 * detection submit form. Coordinate, media, and tag rules mirror the backend;
 * keep them in step with `submitReadiness` (the queue's inline readiness) and
 * the server submit check. Proof must carry an image (`proofHasImage`):
 * a geolocation's proof is a source ↔ satellite cross-reference, so text alone
 * can't be audited.
 */
export function missingEventFields(
  s: EventFieldsState,
  { requireMedia = true, requireTags = true }: EventFieldsOptions = {}
): MissingField[] {
  const lat = parseFloat(s.lat);
  const lng = parseFloat(s.lng);
  const coordsValid =
    !isNaN(lat) &&
    lat >= LAT_MIN &&
    lat <= LAT_MAX &&
    !isNaN(lng) &&
    lng >= LNG_MIN &&
    lng <= LNG_MAX;

  const missing: MissingField[] = [];
  if (!s.title.trim()) missing.push({ key: "title", label: "Title" });
  if (!coordsValid) missing.push({ key: "coordinates", label: "Coordinates" });
  if (!s.sourceUrl.trim()) missing.push({ key: "source_url", label: "Source URL" });
  if (!s.eventDate) missing.push({ key: "event_date", label: "Event date" });
  if (!s.sourcePostedAt) {
    missing.push({ key: "source_posted_at", label: "Source post time" });
  }
  // Proof must exist *and* contain an image. "Proof" (none at all) and "Proof
  // image" (text-only) are distinct misses so the notice says which.
  if (!s.proof) {
    missing.push({ key: "proof", label: "Proof" });
  } else if (!proofHasImage(s.proof)) {
    missing.push({ key: "proof_image", label: "Proof image" });
  }
  if (requireMedia && s.mediaCount === 0) {
    missing.push({ key: "source_media", label: "Source media" });
  }
  if (requireTags && !s.hasConflictTag) {
    missing.push({ key: "conflict_tag", label: "Conflict tag" });
  }
  if (requireTags && !s.hasCaptureSourceTag) {
    missing.push({ key: "capture_source_tag", label: "Capture source tag" });
  }
  return missing;
}

/**
 * Every still-unmet required field for a request (ex-request), as human labels
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
  if (!s.title.trim()) missing.push({ key: "title", label: "Title" });
  if (!s.sourceUrl.trim()) missing.push({ key: "source_url", label: "Source URL" });
  if (!s.sourcePostedAt) {
    missing.push({ key: "source_posted_at", label: "Source post time" });
  }
  if (s.mediaCount === 0) missing.push({ key: "source_media", label: "Source media" });
  return missing;
}

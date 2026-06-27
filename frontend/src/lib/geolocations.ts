import { apiFetch } from "./api";
import { LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN } from "./coordinates";
import { proofHasImage } from "./proof";
import type { GeolocationDetail, GeolocationStatus, TagCategory } from "@/types";

/** A required field a create/edit form is still missing. `key` drives the
 *  in-form highlight; `label` is what `IncompleteFormNotice` lists. Shared by
 *  the geolocation + bounty validators so both feed the same notice + highlight
 *  plumbing. */
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
  status: GeolocationStatus;
}): boolean {
  return g.is_demo && g.status !== "detected";
}

/** Page size for the owner Detections queue. Matches the backend default
 *  (`per_page=20`, capped at 100). */
const DETECTIONS_PER_PAGE = 20;

/** Shape of `GET /geolocations/detections`: full-detail items (media + tags) so
 *  the queue renders the evidence and computes submit-readiness without a
 *  per-row round-trip. Mirrors the backend `PaginatedGeolocationDetails`. */
export interface PaginatedGeolocationDetails {
  items: GeolocationDetail[];
  total: number;
  page: number;
  per_page: number;
}

export function detectionsPath(page = 1, perPage = DETECTIONS_PER_PAGE): string {
  return `/geolocations/detections?page=${page}&per_page=${perPage}`;
}

/**
 * Submit a `detected` geolocation: `POST /geolocations/{id}/submit`, multipart,
 * mirroring create. The form posts the whole state; the server writes it and
 * flips the row to `submitted` (frozen) atomically. New media ride in `files`;
 * existing media are dropped via `remove_media_ids`. Only `detected_from_url`
 * (the provenance anchor) and `status` carry no field. A `detected` row is
 * immutable machine output until this submit, the only write to it.
 */
export interface GeolocationEditInput {
  title: string;
  lat: number;
  lng: number;
  source_url: string;
  /** ISO `YYYY-MM-DD`. */
  event_date: string;
  /** Optional ISO `HH:MM`; empty / omitted clears it. */
  event_time?: string;
  /** ISO datetime (`YYYY-MM-DDTHH:MM`, UTC). Required — a post always has a time. */
  source_posted_at: string;
  proof?: Record<string, unknown> | null;
  /** Replaces the tag set wholesale. */
  tag_ids: string[];
  /** Ids of existing media to drop. */
  remove_media_ids: string[];
  /** New media to upload. */
  files: File[];
}

export function submitGeolocation(
  id: string,
  input: GeolocationEditInput
): Promise<GeolocationDetail> {
  const fd = new FormData();
  fd.append("title", input.title);
  fd.append("lat", String(input.lat));
  fd.append("lng", String(input.lng));
  fd.append("source_url", input.source_url);
  fd.append("event_date", input.event_date);
  if (input.event_time) fd.append("event_time", input.event_time);
  fd.append("source_posted_at", input.source_posted_at);
  if (input.proof) fd.append("proof", JSON.stringify(input.proof));
  if (input.tag_ids.length > 0) fd.append("tag_ids", JSON.stringify(input.tag_ids));
  if (input.remove_media_ids.length > 0) {
    fd.append("remove_media_ids", JSON.stringify(input.remove_media_ids));
  }
  for (const file of input.files) {
    fd.append("files", file);
  }
  return apiFetch<GeolocationDetail>(`/geolocations/${id}/submit`, {
    method: "POST",
    body: fd,
  });
}

/** Soft-delete a `detected` row (re-importable later), distinct from the hard
 *  `DELETE`. The Detections queue surfaces this as "Delete"; to the owner the row
 *  just disappears; the soft/tombstone distinction only matters to the
 *  re-import idempotency on the backend. */
export function rejectGeolocation(id: string): Promise<void> {
  return apiFetch<void>(`/geolocations/${id}/reject`, { method: "POST" });
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
 * it. Delegates to `missingGeolocationFields` (requireMedia + requireTags), the
 * same check the Submit button makes, so the readiness line can never drift from
 * what submitting actually enforces. (The backend floor is the narrower media +
 * `conflict` + `capture_source` tags; the form adds the core fields and a proof
 * image on top, see `missingGeolocationFields`.)
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
  const missing = missingGeolocationFields(
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
export interface GeolocationFieldsState {
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

export interface GeolocationFieldsOptions {
  /** Require >=1 source media. False when a bounty supplies the media. Default
   *  true. */
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
export function missingGeolocationFields(
  s: GeolocationFieldsState,
  { requireMedia = true, requireTags = true }: GeolocationFieldsOptions = {}
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

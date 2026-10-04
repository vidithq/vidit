import type { components } from "@/lib/api-types";

/** Profile links: each value is a handle or a URL; the frontend renders an anchor only when it
 * sniffs an http scheme. Aliased from the per-platform backend schema (the read payloads
 * declare a loose map). */
export type ExternalLinks = components["schemas"]["ExternalLinks"];

export interface User {
  id: string;
  username: string;
  email: string;
  bio: string | null;
  avatar_url: string | null;
  external_links: ExternalLinks;
  created_at: string;
}

export type TagCategory = components["schemas"]["TagRead"]["category"];

/** An archive-import job as the owner polls it (queued by `POST /events/import-archive`,
 *  followed by `GET .../{job_id}`); counts are final once `status` is `done`. */
export type ArchiveImportJob = components["schemas"]["ArchiveImportJobRead"];

/** `POST /events/import-archive/presign`: the staging `upload_key` plus the direct-to-storage
 *  target (`url` + form `fields`). */
export type ArchiveImportPresign = components["schemas"]["ArchiveImportPresignRead"];

export type Tag = components["schemas"]["TagRead"];

/** One row of the conflicts referential (`GET /conflicts`). */
export type Conflict = components["schemas"]["ConflictRead"];

/** The 4-value event lifecycle: `requested` (open call) → `detected` (machine output, marked
 *  until its owner submits) → `geolocated` (a person vouched for it, then corrected as new
 *  versions) → `closed` (taken back by its owner from any of the three). */
export type EventStatus = components["schemas"]["EventRead"]["status"];

/** The state a `closed` row left: `requested` a withdrawn ask, `detected` a rejected reading,
 *  `geolocated` a retracted claim. Null on live rows. */
export type BeforeClosedStatus = NonNullable<
  components["schemas"]["EventRead"]["before_closed_status"]
>;

/** Which entry produced a detection: the bot, a pasted URL, or an archive backfill. Null on
 *  rows imported before the column existed. */
export type DetectedVia = NonNullable<components["schemas"]["EventRead"]["detected_via"]>;

/** Compact point from /events/points: [id, lat, lng, event_date, added_date, detected]. Dates
 *  are ISO `YYYY-MM-DD`; `event_date` is null when unknown (the scrubber skips such points).
 *  `detected` is 1 for a machine detection, 0 for geolocated. Every point has coordinates. */
export type MapPoint = [string, number, number, string | null, string, 0 | 1];

/** Index of the ``detected`` flag in the `MapPoint` tuple. */
export const POINT_DETECTED_FLAG = 5;

/** Lifecycle status from the `detected` flag. Total because `/events/points` serves live
 *  `geolocated` and `detected` rows only (not `requested` guesses or `closed` rows). */
export function pointLifecycleStatus(point: MapPoint): EventStatus {
  return point[POINT_DETECTED_FLAG] === 1 ? "detected" : "geolocated";
}

/** Narrow points to the picked statuses (empty pick = all): the client counterpart of the
 *  server's `?status=` any-match, shared by the map canvas and the filter histograms. */
export function filterPointsByStatus(points: MapPoint[], statuses: string[]): MapPoint[] {
  if (statuses.length === 0) return points;
  return points.filter((p) => statuses.includes(pointLifecycleStatus(p)));
}

/** What one pasted X post did (`POST /events/import-from-tweet`): the ids created, updated and
 * left alone, in engine order. `warnings` are codes for what review must answer; `reason`
 * names the refusal when no detection resulted. */
export type TweetImportOutcome = components["schemas"]["TweetImportRead"];

/** One candidate from the submit-form duplicate probe (`GET /events/possible-duplicates`): a
 * soft warning. `source_url` is null on a sourceless `detected` candidate. */
export type PossibleDuplicate = components["schemas"]["PossibleDuplicateRead"];

/** A stored media row; `sha256` and `original_filename` are null on rows predating those columns. */
export type Media = components["schemas"]["MediaRead"];

/** Full event detail (`GET /events/{id}`, `GET /events/detections`): the compact `EventList`
 *  card plus source URL, proof body, full media list, provenance and `requested_by`. Covers
 *  every lifecycle state; `event_coords` is null on a request without a guess, and
 *  `source_url` / `source_posted_at` are null on a `detected` row with no declared source. */
export type EventDetail = components["schemas"]["EventRead"];

/** One filed version (`GET /events/{id}/versions[/{n}]`). `version_no` is the version the row
 *  holds; `edited_by` / `created_at` / `note` belong to the edit that superseded it (see
 *  `lib/events.ts::eventVersions`). `snapshot` is the editable state then, `{}` when `redacted`. */
export type EventVersion = components["schemas"]["EventVersionRead"];

/** One page of history plus the whole history's size (`total` is not `items.length`). */
export type EventVersionList = components["schemas"]["EventVersionList"];

/** One link's archived copy (snapshot URL and provider), on `archived_source`,
 *  `archived_detected_from` and each index-aligned entry of `archived_secondary_sources`.
 *  Null means no copy recorded. */
export type ArchivedLink = components["schemas"]["ArchivedLinkRead"];

/** Compact event card (`GET /events`). */
export type EventListItem = components["schemas"]["EventList"];

export type SearchType = components["schemas"]["SearchResponse"]["type"];

/** Each hit's `*_highlight` field wraps matches in STX / ETX bytes (U+0002 / U+0003); see
 * `lib/search.ts::splitHighlights`. Rendered as `<mark>` client side, so no raw HTML crosses
 * the API (XSS-safe). */
export type SearchEventHit = components["schemas"]["SearchEventHit"];

/** A requested-view hit: an event card plus `title_highlight`. `source_url` is always set
 *  today (`ck_events_source_url_status`). */
export type SearchRequestHit = components["schemas"]["SearchRequestHit"];

/** An analyst hit; `bio_highlight` is set only when the bio matched. */
export type SearchUserHit = components["schemas"]["SearchUserHit"];

/** Grouped `GET /search` result. `total` holds per-group pre-LIMIT counts; `query` / `type`
 *  echo the inputs so the UI can discard out-of-order responses. */
export type SearchResponse = components["schemas"]["SearchResponse"];

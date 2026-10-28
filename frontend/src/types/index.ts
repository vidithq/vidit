import type { components } from "@/lib/api-types";

/** Profile links: each value is a handle or a URL; the frontend renders an anchor only when it
 * sniffs an http scheme. Aliased from the per-platform backend schema (the read payloads
 * declare a loose map). */
export type ExternalLinks = components["schemas"]["ExternalLinks"];

export type User = Omit<components["schemas"]["UserRead"], "external_links"> & {
  external_links: ExternalLinks;
};

export type AuthorRef = components["schemas"]["AuthorRef"];

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

/** Compact point from /events/points: [id, lat, lng, occurred_date, added_date, detected]. Dates
 *  are ISO `YYYY-MM-DD`; `occurred_date` is null when unknown (the scrubber skips such points).
 *  `detected` is 1 for a machine detection, 0 for geolocated. Every point has coordinates. */
export type MapPoint = [string, number, number, string | null, string, 0 | 1];

/** Index of the ``detected`` flag in the `MapPoint` tuple. */
export const POINT_DETECTED_FLAG = 5;

/** Lifecycle status from the `detected` flag. Total because `/events/points` serves live
 *  `geolocated` and `detected` rows only (not `requested` guesses or `closed` rows). */
function pointLifecycleStatus(point: MapPoint): EventStatus {
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
 * soft warning. `source_urls` is empty on a sourceless `detected` candidate. */
export type PossibleDuplicate = components["schemas"]["PossibleDuplicateRead"];

/** A stored media row: a source's file or a proof image. */
export type Media = components["schemas"]["MediaRead"];

/** Full event detail (`GET /events/{id}`, `GET /events/detections`): the compact `EventList`
 *  card plus the sources, proof body, provenance and `requested_by`. Covers every lifecycle
 *  state; `coords` is null on a request without a guess, and `sources` is empty on a
 *  `detected` row with no declared source. */
/** `viewer_invite_pending` is per reader: only `GET /events/{id}` computes it, so a row from
 *  any other source may lack it. */
export type EventDetail = Omit<components["schemas"]["EventRead"], "viewer_invite_pending"> & {
  viewer_invite_pending?: boolean;
};

/** One filed version (`GET /events/{id}/versions[/{n}]`). `version_no` is the version the row
 *  holds; `edited_by` / `created_at` / `note` belong to the edit that superseded it (see
 *  `lib/events.ts::eventVersions`). `snapshot` is the editable state then, `{}` when `redacted`. */
export type EventVersion = components["schemas"]["EventVersionRead"];

/** One page of history plus the whole history's size (`total` is not `items.length`). */
export type EventVersionList = components["schemas"]["EventVersionList"];

/** One source link's archived copy (snapshot URL, provider, when it was recorded). Null means
 *  no copy recorded. */
export type ArchivedLink = components["schemas"]["ArchivedLinkRead"];

/** Compact event card (`GET /events`). */
export type EventListItem = components["schemas"]["EventList"];

/** Each hit's `*_highlight` field wraps matches in STX / ETX bytes (U+0002 / U+0003); see
 * `lib/search.ts::splitHighlights`. Rendered as `<mark>` client side, so no raw HTML crosses
 * the API (XSS-safe). */
export type SearchEventHit = components["schemas"]["SearchEventHit"];

/** A site hit: the name with `name_highlight`, the kind, the latest source and its image. */
export type SearchSiteHit = components["schemas"]["SearchSiteHit"];

/** A collection hit: the `CollectionRead` every surface renders. */
export type SearchCollectionHit = components["schemas"]["SearchCollectionHit"];

/** An analyst hit; `bio_highlight` is set only when the bio matched. */
export type SearchUserHit = components["schemas"]["SearchUserHit"];

/** An organization hit: the public header fields, `bio_highlight` under the analyst rule. */
export type SearchOrganizationHit = components["schemas"]["SearchOrganizationHit"];

/** One page of `GET /search`: the hits in rank order, the whole match count and the next
 *  page's cursor. */
export type SearchResponse = components["schemas"]["SearchResponse"];

/** One hit, told apart by `type`. */
export type SearchHit = SearchResponse["hits"][number];

export type SearchHitType = SearchHit["type"];

/** `GET /search/sections`: one section per type with a hit. */
export type SearchSections = components["schemas"]["SearchSections"];

/** Events per day on each date axis (`GET /search/dates`, `GET /feed/dates`). */
export type DateHistogram = components["schemas"]["DateHistogram"];
export type DayCount = components["schemas"]["DayCount"];

export type SearchSection = SearchSections["sections"][number];

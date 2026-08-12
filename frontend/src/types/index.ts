import type { components } from "@/lib/api-types";

/**
 * Linktree-style profile links. Each value is free-form: a handle
 * (`@username`) or a URL, and the frontend decides whether to render it as a
 * clickable anchor by sniffing for an http scheme.
 *
 * Aliased from the dedicated backend schema, which is per-platform typed. The
 * read payloads (`UserRead` / `UserProfile`) declare their `external_links`
 * column as a loose `{[key: string]: string | null}` map, so this is the
 * narrow shape the frontend keys off.
 */
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

/** One archive-import job as the owner polls it
 *  (`POST /events/import-archive` returns it queued;
 *  `GET /events/import-archive/{job_id}` follows it). Carries the assemble
 *  counts, final once `status` is `done`. */
export type ArchiveImportJob = components["schemas"]["ArchiveImportJobRead"];

/** `POST /events/import-archive/presign`: the staging `upload_key` to enqueue
 *  with, plus the direct-to-storage upload target (`url` + form `fields`). */
export type ArchiveImportPresign = components["schemas"]["ArchiveImportPresignRead"];

export type Tag = components["schemas"]["TagRead"];

/** One row of the conflicts referential (`GET /conflicts`). `ongoing` drives
 *  the picker's default list; `start_year` / `end_year` disambiguate ended
 *  entries. */
export type Conflict = components["schemas"]["ConflictRead"];

/** The unified 4-value event lifecycle: ``requested`` (an open call to
 *  geolocate, the requested/request view) → ``detected`` (machine output,
 *  rendered marked everywhere until its owner submits it) → ``geolocated`` (a
 *  person vouched for it: via the form, or by submitting a reviewed detection;
 *  not an independent-verification claim, frozen) → ``closed`` (a withdrawn
 *  request). */
export type EventStatus = components["schemas"]["EventRead"]["status"];

/** Compact point from /events/points:
 *  [id, lat, lng, event_date, added_date, detected, demo]. ``event_date`` and
 *  ``added_date`` (the created_at day) are ISO ``YYYY-MM-DD`` strings;
 *  ``event_date`` is null when unknown (optional column), and a null-dated
 *  point is skipped by the event-date scrubber rather than hidden. The
 *  timeline scrubbers bucket the dates for the histograms and filter their
 *  windows client-side. ``detected`` is 1 for a machine detection (marked on
 *  the map), 0 for a geolocated row; ``demo`` is 1 for a demo row (gates the
 *  filter panel's hide-demo toggle). The endpoint only returns located rows,
 *  so every point has coordinates. */
export type MapPoint = [string, number, number, string | null, string, 0 | 1, 0 | 1];

/** Index of the ``detected`` flag in the `MapPoint` tuple. */
export const POINT_DETECTED_FLAG = 5;

/** Decode a point's lifecycle status from its ``detected`` flag.
 *
 *  The binary decode is total: `/events/points` serves live ``geolocated``
 *  and ``detected`` rows only (a ``requested`` guess is not a confident pin,
 *  and a ``closed`` row, whatever its ``before_closed_status``, is judged off
 *  the map by the endpoint's own status predicate), so the flag never has to
 *  encode a third state. The return type pins the two strings to the
 *  generated `EventStatus` vocabulary. */
export function pointLifecycleStatus(point: MapPoint): EventStatus {
  return point[POINT_DETECTED_FLAG] === 1 ? "detected" : "geolocated";
}

/** Narrow points to the picked lifecycle statuses (empty pick = all), the
 *  client-side counterpart of the server's ``?status=`` any-match. Shared by
 *  the map canvas and the filter panel's timeline histograms so the two can't
 *  disagree about what a status chip hides. */
export function filterPointsByStatus(points: MapPoint[], statuses: string[]): MapPoint[] {
  if (statuses.length === 0) return points;
  return points.filter((p) => statuses.includes(pointLifecycleStatus(p)));
}

/** One coordinate pair parsed out of a tweet's text. */
export type TweetImportCoord = components["schemas"]["TweetImportCoord"];

/** One attachment on a parsed tweet. ``kind`` is the shared media-file kind (a
 *  stored `Media`'s ``media_type``); ``origin`` is ``op`` for the analyst's own
 *  attachment (→ proof imagery) and ``quote`` for the quoted-tweet attachment
 *  (→ primary geolocation media). */
export type TweetImportMedia = components["schemas"]["TweetImportMedia"];

/**
 * Pre-fill payload from `POST /events/import-from-tweet`. Best-effort: any
 * field can be empty if the tweet lacks the signal (no coords in the text →
 * ``parsed_coords`` is ``[]``). What the form does with the nullable fields:
 *
 *  - ``source_url``: the quoted tweet's URL when the OP quote-retweets, an
 *    off-platform footage link when the OP declares one, otherwise null (no
 *    fallback to the OP's own URL). Bound directly to the Source URL field,
 *    which starts empty when null.
 *  - ``original_tweet_url``: the OP's URL, kept separately so the proof body
 *    can still credit the analyst when ``source_url`` points at the quote.
 *  - ``source_posted_at``: the source's own post instant. Null when unknown;
 *    the field starts empty rather than falling back to ``posted_at`` (the
 *    OP's own date, which the form truncates to a UTC date).
 *  - ``secondary_source_urls``: the post's other declared links, ordered and
 *    already capped at the event's secondary-link ceiling.
 *  - ``media``: OP + quoted-tweet attachments combined, ``origin`` telling
 *    primary from proof.
 *  - ``detected``: the machine path's view of the same tweet, for inspection.
 */
export type TweetImportResponse = components["schemas"]["TweetImportResponse"];

/**
 * One candidate from the submit-form duplicate probe
 * (GET /events/possible-duplicates). Soft-warning shape, just enough
 * to recognise the same event and decide whether to abandon the submission.
 * ``source_url`` is null on a sourceless ``detected`` candidate.
 */
export type PossibleDuplicate = components["schemas"]["PossibleDuplicateRead"];

/** A stored media row (image or video) on an event. `sha256` /
 *  `original_filename` are null on pre-column + demo-pool rows. */
export type Media = components["schemas"]["MediaRead"];

/** Full event detail (`GET /events/{id}`, `GET /events/detections`).
 *  Adds the source URL, the proof body, the full media list, provenance
 *  (``detected_from_url`` / ``detected_post_at``), and the ``requested_by``
 *  trace on top of the compact ``EventList`` card fields. Covers every
 *  lifecycle state: a ``requested`` row (the requested view) reads through
 *  this same shape, with ``event_coords`` null unless the poster attached a
 *  guess. ``source_url`` and ``source_posted_at`` are null on a ``detected``
 *  row with no declared source; every ``requested`` / ``geolocated`` row
 *  carries a ``source_url``. */
export type EventDetail = components["schemas"]["EventRead"];

/** One link's archived copies: the Wayback Machine URL, the archive.today URL,
 *  and `unavailable`, true only once both providers failed for good. Carried by
 *  `archived_source`, by `archived_detected_from`, and by each entry of
 *  `archived_secondary_sources`, which stays index-aligned with
 *  `secondary_source_urls`. Null in any of them means the link is not tracked
 *  at all (an unpublished draft, a source-less row). */
export type ArchivedCopies = components["schemas"]["ArchivedCopiesRead"];

/** Compact event card (`GET /events`). ``investigator_count`` /
 *  ``investigators_sample`` are populated only on the requested view (the
 *  requested queue); null on the located catalogue. */
export type EventListItem = components["schemas"]["EventList"];

/** The ``type=`` filter values, echoed back on the response. */
export type SearchType = components["schemas"]["SearchResponse"]["type"];

/**
 * Each search hit's ``*_highlight`` field is the original text with STX /
 * ETX bytes (U+0002 / U+0003) around matched fragments — see
 * ``lib/search.ts::splitHighlights`` for the parser. Control bytes never
 * appear in legitimate user text, so users can't forge markers to corrupt
 * the even/odd parity. The frontend renders the fragments as ``<mark>``
 * client-side; no raw HTML crosses the API boundary (XSS-safe).
 */
export type SearchEventHit = components["schemas"]["SearchEventHit"];

/** A requested-view search hit: an event card plus the
 *  ``title_highlight`` fragment; carries ``claimer_count`` so the card
 *  renders the same "N working" badge. ``source_url`` is required-nullable
 *  (a ``requested`` hit always carries one today, per
 *  ``ck_events_source_url_status``). */
export type SearchRequestHit = components["schemas"]["SearchRequestHit"];

/** An analyst search hit. ``bio_highlight`` is populated only when the bio
 *  matched (the backend nulls the unmarked case) so the UI can hide the
 *  snippet block cleanly. */
export type SearchUserHit = components["schemas"]["SearchUserHit"];

/** Grouped `GET /search` result set. ``total`` carries the per-group pre-LIMIT
 *  match counts; ``query`` / ``type`` echo the inputs so the UI can discard
 *  out-of-order responses while the user types. */
export type SearchResponse = components["schemas"]["SearchResponse"];

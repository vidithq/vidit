import type { components } from "@/lib/api-types";

/** Public author summary on an event / bounty / search hit. */
type Author = components["schemas"]["AuthorRef"];

/**
 * Linktree-style profile links. Each value is free-form — handle
 * (`@username`) or URL — and the frontend decides whether to render it as a
 * clickable anchor by sniffing for an http scheme.
 */
export interface ExternalLinks {
  x?: string | null;
  discord?: string | null;
  website?: string | null;
  github?: string | null;
}

export interface User {
  id: string;
  username: string;
  email: string;
  is_trusted: boolean;
  trust_reason: string | null;
  bio: string | null;
  avatar_url: string | null;
  external_links: ExternalLinks;
  created_at: string;
}

export type TagCategory = components["schemas"]["TagRead"]["category"];

/** Result of an archive backfill (`POST /events/import-archive`). */
export type ArchiveImportResult = components["schemas"]["ArchiveImportResult"];

export type Tag = components["schemas"]["TagRead"];

/** The unified 4-value event lifecycle: ``requested`` (an open call to
 *  geolocate, the requested/bounty view) → ``detected`` (machine output,
 *  rendered marked everywhere until its owner submits it) → ``geolocated`` (a
 *  person vouched for it: via the form, or by submitting a reviewed detection;
 *  not an independent-verification claim, frozen) → ``closed`` (a withdrawn
 *  request). */
export type EventStatus = components["schemas"]["EventRead"]["status"];

/** Compact point from /events/points:
 *  [id, lat, lng, event_date, added_date, detected]. ``event_date`` and
 *  ``added_date`` (the created_at day) are ISO ``YYYY-MM-DD`` strings,
 *  the timeline scrubbers bucket them for the histograms and filter their
 *  windows client-side. ``detected`` is 1 for a machine detection (marked on
 *  the map), 0 for a geolocated row. The endpoint only returns located rows, so
 *  every point has coordinates. */
export type MapPoint = [string, number, number, string, string, 0 | 1];

/**
 * Pre-fill payload from POST /events/import-from-tweet. Best-effort:
 * any field can be empty if the tweet lacks the signal (e.g. no coords in
 * the text → ``parsed_coords`` is ``[]``).
 */
export interface TweetImportCoord {
  lat: number;
  lng: number;
}

/** Media file kind, shared by attachment payloads (a tweet-import media's
 *  ``kind`` and a stored ``Media``'s ``media_type``). Derived from the backend
 *  ``MediaType`` literal via the OpenAPI spec. */
export type MediaType = components["schemas"]["MediaRead"]["media_type"];

export interface TweetImportMedia {
  kind: MediaType;
  remote_url: string;
  content_type: string;
  /** ``op`` = analyst's own attachment (→ proof imagery), ``quote`` = the
   *  quoted-tweet attachment (→ primary geolocation media). */
  origin: "op" | "quote";
}

export interface TweetImportQuotedTweet {
  source_url: string;
  author_handle: string;
  tweet_text: string;
}

/** One machine detection the pipeline would produce from a pasted tweet — the
 *  no-persist preview output (zero DB writes). The UI doesn't render this yet
 *  (the analyst-facing preview is deferred); the type keeps the contract
 *  honest with the backend ``DetectedGeolocPreview`` schema. */
export interface DetectedGeolocPreview {
  lat: number;
  lng: number;
  title: string;
  proof_text: string;
  detected_from_url: string;
  event_date: string;
  media: TweetImportMedia[];
}

export interface TweetImportResponse {
  /** SOURCE URL — the quoted tweet's URL when the OP quote-retweets,
   *  otherwise the OP's own URL. The form binds this directly to its
   *  ``Source URL`` field. */
  source_url: string;
  /** The OP's URL, kept separately so the proof body can still credit
   *  the analyst even when ``source_url`` points at the quoted tweet. */
  original_tweet_url: string;
  /** ISO 8601 timestamp from X. The form truncates to date in UTC. */
  posted_at: string;
  author_handle: string;
  tweet_text: string;
  suggested_title: string;
  parsed_coords: TweetImportCoord[];
  /** OP + quoted tweet media combined; ``origin`` tells the frontend
   *  which is primary vs proof. */
  media: TweetImportMedia[];
  quoted_tweet: TweetImportQuotedTweet | null;
  /** The machine path's view of the same tweet — the detections the pipeline
   *  would produce, for inspection. Empty when no coordinate parses. */
  detected: DetectedGeolocPreview[];
}

/**
 * One candidate from the submit-form duplicate probe
 * (GET /events/possible-duplicates). Soft-warning shape, just enough
 * to recognise the same event and decide whether to abandon the submission.
 */
export type PossibleDuplicate = components["schemas"]["PossibleDuplicateRead"];

/** A stored media row (image or video) on an event. `sha256` /
 *  `original_filename` are null on pre-column + demo-pool rows. */
export type Media = components["schemas"]["MediaRead"];

/** Full geolocation detail (`GET /events/{id}`, `GET /events/detections`).
 *  Adds the source URL, the proof body, the full media list, provenance
 *  (``detected_from_url`` / ``detected_post_at``), and the ``requested_by``
 *  trace on top of the compact ``EventList`` card fields. ``lat`` / ``lng`` /
 *  ``event_date`` / ``event_time`` are nullable but always serialised. */
export type EventDetail = components["schemas"]["EventRead"];

/** The requested-view (bounty) shares the one unified lifecycle enum; a
 *  requested row is ``requested`` or (once withdrawn) ``closed``. */
export type BountyStatus = EventStatus;

/** Compact bounty card (`GET /bounties`). The requested-view counterpart of the
 *  ``EventList`` geolocation card: carries the denormalised ``claimer_count``
 *  plus a capped ``claimer_sample`` (newest claimers) for the index avatar strip. */
export type BountyListItem = components["schemas"]["BountyList"];

/** Full bounty detail (`GET /bounties/{id}`). The requested-view counterpart of
 *  {@link EventDetail}: adds the proof body, the ``closed_at`` timestamp, and the
 *  full ``claimers`` list. ``event_date`` / ``event_time`` are nullable (a bounty
 *  is an unfinished geolocation). */
export type BountyDetail = components["schemas"]["BountyRead"];

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

/** A requested-view (bounty) search hit. Mirrors {@link BountyListItem} plus
 *  the ``title_highlight`` fragment; carries ``claimer_count`` so the card
 *  renders the same "N working" badge. */
export type SearchBountyHit = components["schemas"]["SearchBountyHit"];

/** An analyst search hit. ``bio_highlight`` is populated only when the bio
 *  matched (the backend nulls the unmarked case) so the UI can hide the
 *  snippet block cleanly. */
export type SearchUserHit = components["schemas"]["SearchUserHit"];

/** Grouped `GET /search` result set. ``total`` carries the per-group pre-LIMIT
 *  match counts; ``query`` / ``type`` echo the inputs so the UI can discard
 *  out-of-order responses while the user types. */
export type SearchResponse = components["schemas"]["SearchResponse"];

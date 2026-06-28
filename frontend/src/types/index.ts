import type { components } from "@/lib/api-types";

interface Author {
  id: string;
  username: string;
  is_trusted: boolean;
  trust_reason: string | null;
}

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

export interface Tag {
  id: string;
  name: string;
  category: TagCategory;
}

/** Lifecycle status. ``submitted`` = a person submitted it (the norm: via the
 *  form, or by submitting a reviewed detection; not an independent-verification
 *  claim); ``detected`` = machine output, rendered marked everywhere until its
 *  owner submits it. */
export type GeolocationStatus = components["schemas"]["GeolocationRead"]["status"];

interface GeolocationListItem {
  id: string;
  title: string;
  lat: number;
  lng: number;
  event_date: string;
  is_demo: boolean;
  status: GeolocationStatus;
  author: Author;
  tags: Tag[];
}

/** Compact point from /geolocations/points:
 *  [id, lat, lng, event_date, added_date, detected]. ``event_date`` and
 *  ``added_date`` (the created_at day) are ISO ``YYYY-MM-DD`` strings,
 *  the timeline scrubbers bucket them for the histograms and filter their
 *  windows client-side. ``detected`` is 1 for a machine detection (marked on
 *  the map), 0 for a submitted row. */
export type MapPoint = [string, number, number, string, string, 0 | 1];

/**
 * Pre-fill payload from POST /geolocations/import-from-tweet. Best-effort:
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
 * (GET /geolocations/possible-duplicates). Soft-warning shape — just enough
 * to recognise the same event and decide whether to abandon the submission.
 */
export interface PossibleDuplicate {
  id: string;
  title: string;
  lat: number;
  lng: number;
  event_date: string;
  source_url: string;
  /** Geodesic distance in metres from the proposed coordinates. */
  distance_m: number;
  author: Author;
}

export interface Media {
  id: string;
  storage_url: string;
  media_type: MediaType;
  /** Hex-encoded SHA-256 of the uploaded bytes. `null` on pre-column
   *  rows and demo-pool references that don't go through an upload pass. */
  sha256?: string | null;
  /** Filename the analyst's browser sent at upload time. Surfaced so
   *  an investigator can trace evidence back to a source post by name. */
  original_filename?: string | null;
}

export interface GeolocationDetail extends GeolocationListItem {
  source_url: string;
  /** Optional time-of-day for ``event_date`` (UTC, ``HH:MM:SS``); null when the
   *  hour is unknown. */
  event_time: string | null;
  /** When the original source posted the media: a real post instant (UTC),
   *  always present. ISO datetime. Distinct from ``event_date`` (when the event
   *  happened) and ``created_at`` (submission). */
  source_posted_at: string;
  /** For a ``detected`` row, the post it was imported from — a provenance
   *  link distinct from ``source_url`` (footage origin). Null for human
   *  submits. */
  detected_from_url: string | null;
  /** When the analyst posted this geolocation on X (the imported tweet's time);
   *  null for human submits. The "who geolocated first" precedence signal. */
  detected_post_at: string | null;
  proof: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  media: Media[];
  /** Set when promoted from a bounty — lets the detail page render
   *  "originally posted as a bounty by @x". */
  originated_from_bounty: {
    id: string;
    title: string;
    author: Author;
  } | null;
}

export type BountyStatus = components["schemas"]["BountyRead"]["status"];

export interface BountyListItem {
  id: string;
  title: string;
  source_url: string;
  status: BountyStatus;
  created_at: string;
  /** TRUE iff seeded by the admin "Demo bounties" panel. The UI swaps the
   *  synthetic source_url for a "synthetic" label so beta testers don't
   *  click out to a 404. Mirrors GeolocationListItem.is_demo. */
  is_demo: boolean;
  author: Author;
  media: Media[];
  tags: Tag[];
  /** Total number of analysts currently signaling "I'm working on this". */
  claimer_count: number;
  /** Newest claimers, capped server-side (typically 3) — avatar strip on the index. */
  claimer_sample: Author[];
}

export interface BountyDetail {
  id: string;
  title: string;
  source_url: string;
  /** The in-progress proof (Tiptap JSON), mirroring a geolocation's `proof`.
   *  Optional and image-free. Null when the poster left it empty. */
  proof: Record<string, unknown> | null;
  /** When the event happened: date (ISO YYYY-MM-DD) + optional UTC time-of-day.
   *  Nullable: a bounty is an unfinished geolocation. */
  event_date: string | null;
  event_time: string | null;
  /** When the source posted the media: a real post instant (UTC), always
   *  present (the bounty's source_url is required). ISO datetime. */
  source_posted_at: string;
  status: BountyStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  is_demo: boolean;
  author: Author;
  media: Media[];
  tags: Tag[];
  /** Full list of analysts currently signaling on this bounty. */
  claimers: Author[];
  fulfilled_by: { id: string; title: string } | null;
}

export type SearchType = "all" | "geolocation" | "bounty" | "user";

/**
 * Each search hit's ``*_highlight`` field is the original text with STX /
 * ETX bytes (U+0002 / U+0003) around matched fragments — see
 * ``lib/search.ts::splitHighlights`` for the parser. Control bytes never
 * appear in legitimate user text, so users can't forge markers to corrupt
 * the even/odd parity. The frontend renders the fragments as ``<mark>``
 * client-side; no raw HTML crosses the API boundary (XSS-safe).
 */
export interface SearchGeolocationHit {
  id: string;
  title: string;
  title_highlight: string;
  lat: number;
  lng: number;
  event_date: string;
  is_demo: boolean;
  status: GeolocationStatus;
  author: Author;
  tags: Tag[];
}

export interface SearchBountyHit {
  id: string;
  title: string;
  title_highlight: string;
  source_url: string;
  status: BountyStatus;
  created_at: string;
  is_demo: boolean;
  author: Author;
  media: Media[];
  tags: Tag[];
  /** Mirrors ``BountyListItem.claimer_count`` so the card renders the
   *  same "N working" badge. */
  claimer_count: number;
}

export interface SearchUserHit {
  id: string;
  username: string;
  username_highlight: string;
  bio: string | null;
  /** Populated only when the bio matched (backend nulls the unmarked case)
   *  so the UI can hide the snippet block cleanly. */
  bio_highlight: string | null;
  is_trusted: boolean;
  trust_reason: string | null;
  avatar_url: string | null;
}

export interface SearchResponse {
  geolocations: SearchGeolocationHit[];
  bounties: SearchBountyHit[];
  users: SearchUserHit[];
  /** Denormalised counts so the group headers don't re-sum the lists. */
  total: { geolocations: number; bounties: number; users: number };
  /** Echoed input — comparing ``query`` to the current input lets the UI
   *  discard out-of-order responses while the user types. */
  query: string;
  type: SearchType;
}

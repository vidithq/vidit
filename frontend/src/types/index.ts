interface Author {
  id: string;
  username: string;
  is_trusted: boolean;
  trust_reason: string | null;
}

/**
 * Linktree-style profile links. Each value is a free-form string —
 * handle (`@username`) or URL — the frontend decides whether to render
 * any given value as a clickable anchor by sniffing it for an http
 * scheme.
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

export type TagCategory = "conflict" | "capture_source" | "free";

export interface Tag {
  id: string;
  name: string;
  category: TagCategory;
}

interface GeolocationListItem {
  id: string;
  title: string;
  lat: number;
  lng: number;
  event_date: string;
  is_demo: boolean;
  author: Author;
  tags: Tag[];
}

/** Compact point from /geolocations/points: [id, lat, lng] */
export type MapPoint = [string, number, number];

/**
 * Pre-fill payload returned by POST /geolocations/import-from-tweet.
 * Best-effort shape: any field can be empty if the tweet doesn't carry
 * the matching signal (e.g. no coords in the text → ``parsed_coords``
 * is ``[]``).
 */
export interface TweetImportCoord {
  lat: number;
  lng: number;
}

export interface TweetImportMedia {
  kind: "image" | "video";
  remote_url: string;
  content_type: string;
  /** ``op`` = analyst's own attachment (becomes proof imagery on the
   *  form), ``quote`` = the quoted-tweet attachment (becomes the
   *  primary geolocation media). */
  origin: "op" | "quote";
}

export interface TweetImportQuotedTweet {
  source_url: string;
  author_handle: string;
  tweet_text: string;
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
}

/**
 * One candidate returned by the submit-form duplicate probe
 * (GET /geolocations/possible-duplicates). Soft-warning shape — just
 * enough to recognise "yeah, this is the same event" and decide
 * whether to abandon the in-progress submission.
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

interface Media {
  id: string;
  storage_url: string;
  media_type: "image" | "video";
  /** Hex-encoded SHA-256 of the uploaded bytes. `null` on pre-column
   *  rows and demo-pool references that don't go through an upload pass. */
  sha256?: string | null;
  /** Filename the analyst's browser sent at upload time. Surfaced so
   *  an investigator can trace evidence back to a source post by name. */
  original_filename?: string | null;
}

export interface GeolocationDetail extends GeolocationListItem {
  source_url: string;
  proof: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  media: Media[];
  /** Set when the geolocation was promoted from a bounty — the trace
   *  that lets the detail page render "originally posted as a bounty by @x". */
  originated_from_bounty: {
    id: string;
    title: string;
    author: Author;
  } | null;
}

export type BountyStatus = "open" | "fulfilled" | "closed";

export interface BountyListItem {
  id: string;
  title: string;
  source_url: string;
  status: BountyStatus;
  created_at: string;
  /** TRUE iff seeded by the admin "Demo bounties" panel. The seeded
   *  imagery and the always-attached `demo` tag are the visible
   *  signals; the UI uses this flag to swap the synthetic source_url
   *  for a "synthetic" label so beta testers don't click out to a 404.
   *  Mirrors GeolocationListItem.is_demo. */
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
  description: Record<string, unknown> | null;
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

// ── Search ───────────────────────────────────────────────────────────

export type SearchType = "all" | "geolocation" | "bounty" | "user";

/**
 * Each search hit carries a ``*_highlight`` field that's the original
 * text with STX / ETX bytes (U+0002 / U+0003) around matched fragments —
 * see ``lib/search.ts::splitHighlights`` for the parser. Control bytes
 * never appear in legitimate user text, so users can't forge marker
 * tokens to corrupt the highlight string's even/odd parity. The
 * frontend turns the wrapped fragments into ``<mark>`` elements
 * client-side; no raw HTML crosses the API boundary (XSS-safe by
 * construction).
 */
export interface SearchGeolocationHit {
  id: string;
  title: string;
  title_highlight: string;
  lat: number;
  lng: number;
  event_date: string;
  is_demo: boolean;
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
  /** Only populated when the bio actually matched (backend filters
   *  the unmarked case to null) so the UI can hide the snippet block
   *  cleanly. */
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
  /** Echoed inputs — the browser may have multiple requests in flight
   *  while the user types; comparing ``query`` to the current input
   *  lets the UI discard out-of-order responses. */
  query: string;
  type: SearchType;
}

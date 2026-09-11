/**
 * Wire payloads the mocked backend serves. Each one is the shape its endpoint
 * declares in `frontend/openapi.json`, filled with enough content that a page
 * lays out the way it does against a real row: a titled event with media, proof,
 * a tag and a conflict, rather than an empty husk that hides an overflow.
 *
 * Typed as the generated frontend aliases, so a backend schema change reaches
 * the suite through the same drift gate every other reader goes through.
 */
import type {
  Conflict,
  EventDetail,
  EventListItem,
  Tag,
  User,
} from "@/types";

import { MEDIA_ORIGIN } from "./environment";

/** Id of the event the shared-link spec opens. */
export const EVENT_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Where the event's media fixture lives. `next.config.mjs` lists this origin
 * under `images.remotePatterns`, so `next/image` accepts the `src` instead of
 * throwing at render and dropping the page into `app/error.tsx`. The bytes
 * come from `mockApi`, not from a server on that port.
 */
export const MEDIA_URL = `${MEDIA_ORIGIN}/e2e-fixture-media.png`;

export const SIGNED_IN_USER: User = {
  id: "22222222-2222-4222-8222-222222222222",
  username: "analyst",
  email: "analyst@example.com",
  bio: "Open source researcher covering strike footage.",
  avatar_url: null,
  external_links: {},
  created_at: "2025-01-04T09:00:00Z",
};

/**
 * Name of the tag that measures `<Pill>`'s wrap. One token with no space in it,
 * longer than the content column of any card at 320px, so a pill that fails to
 * break inside its own box runs past the card and scrolls the page sideways.
 * The backend accepts it: `schemas/tag.py` caps the name's length and nothing
 * else, so this is a tag an analyst can actually create.
 */
export const LONG_TAG_NAME = "counterbatteryradarreconnaissance";

export const CURATED_TAGS: Tag[] = [
  { id: "33333333-3333-4333-8333-333333333331", name: "Drone", category: "capture_source" },
  { id: "33333333-3333-4333-8333-333333333332", name: "CCTV", category: "capture_source" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Armour", category: "free" },
  { id: "33333333-3333-4333-8333-333333333334", name: LONG_TAG_NAME, category: "free" },
];

export const CONFLICTS: Conflict[] = [
  {
    id: "44444444-4444-4444-8444-444444444441",
    name: "Russian invasion of Ukraine",
    wikidata_id: "Q110999040",
    start_year: 2022,
    end_year: null,
    tier: "major",
    ongoing: true,
  },
];

export const EVENT: EventDetail = {
  id: EVENT_ID,
  title: "Armoured column on a residential street near the eastern approach road",
  event_coords: { lat: 48.4647, lng: 35.0462 },
  capture_source_coords: null,
  source_url: "https://x.com/example/status/1234567890123456789",
  archived_source: {
    url: "https://web.archive.org/web/20250104120000/https://x.com/example/status/1234567890123456789",
    provider: "wayback",
  },
  secondary_source_urls: [],
  archived_secondary_sources: [],
  proof: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The tree line and the pair of concrete utility poles match the reference imagery, and the roof vents line up with the satellite view.",
          },
        ],
      },
    ],
  },
  event_date: "2025-01-03",
  event_time: "14:20:00",
  source_posted_at: "2025-01-03T15:05:00Z",
  created_at: "2025-01-04T10:11:00Z",
  geolocated_at: "2025-01-04T10:11:00Z",
  closed_at: null,
  is_graphic: false,
  status: "geolocated",
  version_no: 1,
  close_reason: null,
  before_closed_status: null,
  detected_from_url: null,
  detected_via: null,
  archived_detected_from: null,
  owner: {
    id: SIGNED_IN_USER.id,
    username: SIGNED_IN_USER.username,
    avatar_url: null,
  },
  requested_by: null,
  geolocators: [],
  media: [
    {
      id: "55555555-5555-4555-8555-555555555551",
      role: "source",
      media_type: "image",
      storage_url: MEDIA_URL,
      original_filename: "street.png",
      sha256: null,
    },
  ],
  thumbnail: {
    id: "55555555-5555-4555-8555-555555555551",
    role: "source",
    media_type: "image",
    storage_url: MEDIA_URL,
    original_filename: "street.png",
    sha256: null,
  },
  tags: [CURATED_TAGS[0], CURATED_TAGS[2], CURATED_TAGS[3]],
  conflicts: CONFLICTS,
};

/**
 * The one open request the board serves, carrying the long tag. The request
 * card is the narrowest content column in the product (about 150px at 320px,
 * beside a thumbnail and a status badge), which is where a tag that does not
 * wrap inside its pill runs past the card and scrolls the page sideways.
 */
export const REQUESTED_EVENT: EventListItem = {
  id: "66666666-6666-4666-8666-666666666661",
  title: "Strike on a rail yard, footage from a passing car",
  status: "requested",
  before_closed_status: null,
  event_coords: null,
  event_date: "2025-01-02",
  is_graphic: false,
  media: null,
  owner: {
    id: SIGNED_IN_USER.id,
    username: SIGNED_IN_USER.username,
    avatar_url: null,
  },
  tags: [CURATED_TAGS[3]],
  conflicts: CONFLICTS,
};

/** An empty first page of the owner's detection queue, as the sidebar reads it. */
export const EMPTY_DETECTIONS = {
  items: [],
  total: 0,
  page: 1,
  per_page: 1,
  ready_total: 0,
  incomplete_total: 0,
};

/**
 * A maplibre style with nothing in it. The map still mounts, sizes itself and
 * draws the app's own point layers; only CARTO's basemap tiles are absent, and
 * those are a network dependency a smoke suite should not carry.
 */
export const EMPTY_BASEMAP_STYLE = {
  version: 8,
  name: "e2e blank basemap",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#111111" },
    },
  ],
};

/** A 1x1 transparent PNG, so a media slot has real bytes to lay out around. */
export const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

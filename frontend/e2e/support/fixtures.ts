/**
 * Wire payloads the mocked backend serves. Each one is the shape its endpoint
 * declares in `frontend/openapi.json`, filled with enough content that a page
 * lays out the way it does against a real row: a titled event with media, proof,
 * a tag and a conflict, rather than an empty husk that hides an overflow.
 *
 * Typed as the generated frontend aliases, so a backend schema change reaches
 * the suite through the same drift gate every other reader goes through.
 */
import type { components } from "@/lib/api-types";
import type { Approval, OrganizationApproval } from "@/lib/approvals";
import type { Collection } from "@/lib/collections";
import type { Notification, UnreadCount } from "@/lib/notifications";
import type {
  InviteCandidate,
  Organization,
  OrganizationInvite,
  OrganizationMember,
  OrganizationMembership,
} from "@/lib/organizations";
import type { UserPreferences } from "@/lib/preferences";
import type { PublicProfile, UserStats } from "@/lib/users";
import type { OrganizationApprovalRequest } from "@/lib/approvalRequests";
import type { Upload } from "@/lib/sources";
import type { XHandleState } from "@/lib/xHandle";
import type {
  Conflict,
  EventDetail,
  EventListItem,
  SearchResponse,
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

export const TAGS: Tag[] = [
  { id: "33333333-3333-4333-8333-333333333331", name: "Drone" },
  { id: "33333333-3333-4333-8333-333333333332", name: "CCTV" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Armour" },
  { id: "33333333-3333-4333-8333-333333333334", name: LONG_TAG_NAME },
];

export const CONFLICTS: Conflict[] = [
  {
    id: "44444444-4444-4444-8444-444444444441",
    name: "Russian invasion of Ukraine",
    wikidata_id: "Q110999040",
    start_year: 2022,
    end_year: null,
    tier: "major",
    is_ongoing: true,
  },
];

export const EVENT: EventDetail = {
  id: EVENT_ID,
  title: "Armoured column on a residential street near the eastern approach road",
  coords: { lat: 48.4647, lng: 35.0462 },
  proof: "<p>The tree line and the pair of concrete utility poles match the reference imagery, and the roof vents line up with the satellite view.</p>",
  occurred_date: "2025-01-03",
  occurred_time: "14:20:00",
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
  owner: {
    id: SIGNED_IN_USER.id,
    username: SIGNED_IN_USER.username,
    avatar_url: null,
  },
  requested_by: null,
  geolocators: [],
  sources: [
    {
      id: "55555555-5555-4555-8555-555555555561",
      title: "Street footage from a passing car",
      level: "direct",
      kind: "dashcam",
      captured_at: "2025-01-03T14:20:00Z",
      capture_position: null,
      is_graphic: false,
      links: [
        {
          url: "https://x.com/example/status/1234567890123456789",
          posted_at: "2025-01-03T16:02:00Z",
          archived: {
            url: "https://web.archive.org/web/20250104120000/https://x.com/example/status/1234567890123456789",
            provider: "wayback",
            archived_at: "2025-01-04T12:00:00Z",
          },
        },
      ],
      tags: [],
      media: {
        id: "55555555-5555-4555-8555-555555555551",
        role: "source",
        kind: "image",
        storage_url: MEDIA_URL,
        original_filename: "street.png",
        sha256: "0".repeat(64),
      },
      warnings: [],
    },
  ],
  thumbnail: {
    id: "55555555-5555-4555-8555-555555555551",
    role: "source",
    kind: "image",
    storage_url: MEDIA_URL,
    original_filename: "street.png",
    sha256: "0".repeat(64),
  },
  tags: [TAGS[0], TAGS[2], TAGS[3]],
  conflicts: CONFLICTS,
};

/**
 * The shared event with four sources, which the page lays out as a sideways row. The first
 * carries a capture position and a second, long link, so its rows hold the longest values a
 * source card shows.
 */
export const EVENT_WITH_SOURCES: EventDetail = {
  ...EVENT,
  sources: [1, 2, 3, 4].map((n) => ({
    ...EVENT.sources[0],
    id: `55555555-5555-4555-8555-55555555557${n}`,
    title: `Source footage ${n}`,
    capture_position: n === 1 ? { lat: 48.464712, lng: 35.046245 } : null,
    links:
      n === 1
        ? [
            ...EVENT.sources[0].links,
            {
              url: "https://www.gettyimages.com/detail/news-photo/residential-street-after-the-strike-2299208753",
              posted_at: null,
              archived: null,
            },
          ]
        : EVENT.sources[0].links,
  })),
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
  requested_at: null,
  geolocators: [],
  coords: null,
  occurred_date: "2025-01-02",
  is_graphic: false,
  media: null,
  owner: {
    id: SIGNED_IN_USER.id,
    username: SIGNED_IN_USER.username,
    avatar_url: null,
  },
  tags: [TAGS[3]],
  conflicts: CONFLICTS,
};

/** The feed's one row: the open request, stamped with when it entered the feed. */
export const FEED_ITEMS: components["schemas"]["FeedItemRead"][] = [
  { ...REQUESTED_EVENT, feed_at: "2025-01-03T09:00:00Z" },
];

/** A search that matched nothing, what the filtered search page reads. */
export const EMPTY_SEARCH: SearchResponse = {
  geolocations: [],
  requests: [],
  collections: [],
  users: [],
  organizations: [],
  total: { geolocations: 0, requests: 0, collections: 0, users: 0, organizations: 0 },
  query: "",
  type: "event",
};

/** Id of the collection the collection-page spec opens. */
export const COLLECTION_ID = "77777777-7777-4777-8777-777777777771";

/** What that collection says it holds. Long enough to run past one line at
 *  both phone widths, which is what the narrow-column checks measure. The
 *  fixture carries it as the document the owner wrote and as the plain-text
 *  projection the card clamps, the pair every read serves. */
const COLLECTION_DESCRIPTION =
  "Every strike on the rail corridor between 3 and 5 January 2025, with the damage each one left on the line.";

/**
 * The collection that spec reads, owned by the signed-in user so the owner's
 * controls render and get measured: the header's Edit and Drop controls, the
 * link to the owner's own catalogue, and the edit page behind the first of
 * them, where the item picker lives.
 *
 * It carries a one-tile mosaic, which the profile card wears and the
 * collection's own page does not. The title is long enough to take the whole
 * heading row at 320px, which is what pushes the action cluster onto its own
 * line, and the description runs past one line at both phone widths.
 */
export const COLLECTION: Collection = {
  id: COLLECTION_ID,
  owner: {
    id: SIGNED_IN_USER.id,
    username: SIGNED_IN_USER.username,
    avatar_url: null,
  },
  title: "Kupiansk rail corridor: three days of strikes on the eastern approach",
  description: `<p>${COLLECTION_DESCRIPTION}</p>`,
  description_text: COLLECTION_DESCRIPTION,
  cover: [{ url: MEDIA_URL, kind: "image", role: "source" }],
  tags: [],
  event_count: 2,
  first_date: "2025-01-03",
  last_date: "2025-01-04",
  created_at: "2025-01-05T08:00:00Z",
};

/**
 * The collection's first item: a published geolocation, the only kind a
 * collection shows. It carries the long tag and the coordinates line, so the
 * row is measured with everything a card can hold plus the owner's remove
 * control in the badge column.
 */
export const COLLECTED_EVENT: EventListItem = {
  id: EVENT_ID,
  title: EVENT.title,
  status: "geolocated",
  before_closed_status: null,
  requested_at: null,
  geolocators: [],
  coords: { lat: 48.4647, lng: 35.0462 },
  occurred_date: "2025-01-03",
  is_graphic: false,
  media: EVENT.thumbnail,
  owner: {
    id: SIGNED_IN_USER.id,
    username: SIGNED_IN_USER.username,
    avatar_url: null,
  },
  tags: [TAGS[3]],
  conflicts: CONFLICTS,
};

/** Id of the collection's second item. */
export const SECOND_COLLECTED_EVENT_ID = "11111111-1111-4111-8111-111111111112";

/**
 * The collection's second item.
 *
 * Two items and not one, because the page's step player is what the spec
 * measures: with a single item both step controls are disabled and the run
 * never says whether a reader on a phone can actually reach the next event.
 */
export const SECOND_COLLECTED_EVENT: EventListItem = {
  ...COLLECTED_EVENT,
  id: SECOND_COLLECTED_EVENT_ID,
  title: "Damaged locomotive shed at the yard's western end",
  coords: { lat: 48.4712, lng: 35.0588 },
  occurred_date: "2025-01-04",
};

/** That item's own read, which the player's panel renders on step 2. */
export const SECOND_COLLECTED_EVENT_DETAIL: EventDetail = {
  ...EVENT,
  id: SECOND_COLLECTED_EVENT_ID,
  title: SECOND_COLLECTED_EVENT.title,
  coords: SECOND_COLLECTED_EVENT.coords,
  occurred_date: "2025-01-04",
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

/** The signed-in analyst's preferences with nothing saved: every value its default. */
export const DEFAULT_PREFERENCES: UserPreferences = {
  display: { palette: "orange", theme: "dark", help_tooltips: true },
  display_defaults: { palette: "orange", theme: "dark", help_tooltips: true },
  display_stored: { palette: null, theme: null, help_tooltips: null },
  notifications: [
    { kind: "request_fulfilled", email: true, default: true },
    { kind: "new_follower", email: false, default: false },
    { kind: "organization_invite", email: true, default: true },
    { kind: "organization_invite_accepted", email: false, default: false },
    { kind: "organization_manager_inherited", email: true, default: true },
  ],
  approval_request_audience: "following",
};

/** A bound handle, as the Account card reads it. */
export const X_HANDLE: XHandleState = {
  x_handle: "osint_hawk_2024",
};

/** Slug of the organization the signed-in analyst manages. */
export const ORGANIZATION_SLUG = "open-source-watch";

export const ORGANIZATION: Organization = {
  id: "88888888-8888-4888-8888-888888888881",
  slug: ORGANIZATION_SLUG,
  name: "Open Source Watch, a collective of strike footage geolocators",
  x_handle: "osw",
  bio: "We geolocate strike footage and publish the proof. https://example.org/a-long-path-that-must-wrap",
  avatar_url: null,
  external_links: { x: "osw", website: "https://example.org" },
  created_at: "2025-03-01T09:00:00Z",
  member_count: 2,
  approval_request_audience: "following",
  viewer_role: "manager",
  viewer_invited: false,
  viewer_can_manage: true,
};

export const ORGANIZATION_MEMBERS: OrganizationMember[] = [
  {
    user: { id: SIGNED_IN_USER.id, username: SIGNED_IN_USER.username, avatar_url: null },
    role: "manager",
    joined_at: "2025-03-01T09:00:00Z",
  },
  {
    user: {
      id: "99999999-9999-4999-8999-999999999991",
      username: "a_member_with_a_rather_long_username",
      avatar_url: null,
    },
    role: "member",
    joined_at: "2025-04-01T09:00:00Z",
  },
];

export const INVITE_CANDIDATES: InviteCandidate[] = [
  { id: "99999999-9999-4999-8999-999999999992", username: "mutual", avatar_url: null },
  {
    id: "99999999-9999-4999-8999-999999999995",
    username: "a_mutual_follow_with_a_username_long_enough_to_wr",
    avatar_url: null,
  },
];

export const ORGANIZATION_INVITES: OrganizationInvite[] = [
  {
    user: { id: "99999999-9999-4999-8999-999999999994", username: "invitee", avatar_url: null },
    invited_by: { id: SIGNED_IN_USER.id, username: SIGNED_IN_USER.username, avatar_url: null },
    invited_at: "2025-05-01T09:00:00Z",
  },
];

/** A staged source file, as `POST /uploads` answers it. */
export const UPLOAD: Upload = {
  id: "55555555-5555-4555-8555-555555555571",
  kind: "image",
  sha256: "0".repeat(64),
  original_filename: "street.png",
  storage_url: MEDIA_URL,
  expires_at: "2099-01-01T00:00:00Z",
};

/** Nothing unread, as the sidebar's notification row reads it. */
export const NO_UNREAD: UnreadCount = { count: 0 };

const LONG_EVENT_TITLE =
  "Strike on the fuel depot north of the river crossing, seen from the eastern ridge at dusk";

/** The notification feed: an open approval request and an
 *  answered one, both naming a long event title a phone must not squeeze. */
export const NOTIFICATION_FEED: Notification[] = [
  {
    id: "4b0d6c1e-0000-4000-8000-000000000001",
    kind: "approval_request_received",
    created_at: "2026-10-16T09:00:00Z",
    actor: { id: "4b0d6c1e-0000-4000-8000-0000000000a1", username: "maya", avatar_url: null },
    event: { id: EVENT_ID, title: LONG_EVENT_TITLE },
    organization: null,
    read_at: "2026-10-16T10:00:00Z",
    approval_request_status: null,
  },
  {
    id: "4b0d6c1e-0000-4000-8000-000000000002",
    kind: "approval_request_received",
    created_at: "2026-10-15T09:00:00Z",
    actor: { id: "4b0d6c1e-0000-4000-8000-0000000000a2", username: "jules", avatar_url: null },
    event: { id: EVENT_ID, title: LONG_EVENT_TITLE },
    organization: null,
    read_at: "2026-10-15T10:00:00Z",
    approval_request_status: "declined",
  },
];

const ORGANIZATION_REF = { slug: ORGANIZATION_SLUG, name: ORGANIZATION.name, avatar_url: null };

/** The signed-in analyst's profile as `GET /users/{username}` serves it. */
export const ANALYST_PROFILE: PublicProfile = {
  id: SIGNED_IN_USER.id,
  username: SIGNED_IN_USER.username,
  bio: SIGNED_IN_USER.bio,
  avatar_url: null,
  external_links: { x: "analyst", website: "https://example.org" },
  followers_count: 1204,
  following_count: 318,
  geolocations_count: 12,
  created_at: SIGNED_IN_USER.created_at,
  is_following: false,
};

/** Org manager of one organization and member of five more: a row of logos long enough to wrap
 * the identity line at 320px. */
export const ANALYST_ORGANIZATIONS: OrganizationMembership[] = [
  { organization: ORGANIZATION_REF, role: "manager", joined_at: "2025-03-01T09:00:00Z" },
  ...["sahel-desk", "black-sea-watch", "geo-confirmed", "eastern-front", "rail-monitor"].map(
    (slug) => ({
      organization: { slug, name: `Organization ${slug}`, avatar_url: null },
      role: "member" as const,
      joined_at: "2025-05-01T09:00:00Z",
    }),
  ),
];

export const ANALYST_STATS: UserStats = {
  total_events: 12,
  geolocated_count: 12,
  detected_count: 0,
  media_count: 20,
  top_conflicts: [{ name: "Russia-Ukraine", count: 12 }],
  source_kinds: [{ name: "drone", count: 8 }],
  source_hosts: [{ name: "t.me", count: 12 }],
  other_hosts_count: 0,
  no_source_count: 0,
  activity: Array.from({ length: 6 }, (_, i) => ({
    period: `2025-0${i + 1}`,
    count: i,
  })),
};

const SECOND_REVIEWER = {
  id: "77777777-7777-4777-8777-777777777771",
  username: "second_reviewer_with_a_long_handle",
  avatar_url: null,
};

/** The live version's approvals on the shared event: one by an analyst, one the organization's
 *  long name signs, and fourteen more, so the card's two
 *  rows of stamps fold into a `+N` bubble and the Approvals panel is measured at phone widths. */
export const EVENT_APPROVALS: Approval[] = [
  {
    id: "66666666-6666-4666-8666-666666666661",
    version_no: 1,
    reviewer: SECOND_REVIEWER,
    created_at: "2025-01-05T08:30:00Z",
    current: true,
    organization: null,
  },
  {
    id: "66666666-6666-4666-8666-666666666662",
    version_no: 1,
    reviewer: { id: SIGNED_IN_USER.id, username: SIGNED_IN_USER.username, avatar_url: null },
    created_at: "2025-01-06T08:30:00Z",
    current: true,
    organization: ORGANIZATION_REF,
  },
  ...Array.from({ length: 14 }, (_, i) => i + 3).map(
    (n): Approval => ({
      id: `66666666-6666-4666-8666-6666666666${String(n).padStart(2, "6")}`,
      version_no: 1,
      reviewer: {
        id: `77777777-7777-4777-8777-7777777777${String(n).padStart(2, "7")}`,
        username: `reviewer_${n}`,
        avatar_url: null,
      },
      created_at: `2025-01-${String(n + 4).padStart(2, "0")}T08:30:00Z`,
      current: true,
      organization: null,
    }),
  ),
];

/** The approvals placed in the organization's name, as its page lists them. */
export const ORGANIZATION_APPROVALS: OrganizationApproval[] = [
  { event: { id: EVENT_ID, title: EVENT.title }, approval: EVENT_APPROVALS[1] },
];

/** One open request to the organization, which its org manager can decline. */
export const ORGANIZATION_APPROVAL_REQUESTS: OrganizationApprovalRequest[] = [
  {
    event: { id: EVENT_ID, title: EVENT.title },
    request: {
      id: "66666666-6666-4666-8666-666666666671",
      event_id: EVENT_ID,
      version_no: 1,
      requester: SECOND_REVIEWER,
      target: null,
      target_organization: ORGANIZATION_REF,
      status: "open",
      created_at: "2025-01-07T08:30:00Z",
      resolved_at: null,
    },
  },
];

/**
 * A maplibre style with nothing in it. The map still mounts, sizes itself and
 * draws the app's own point layers; only the basemap tiles are absent, and
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

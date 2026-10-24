import type { Source } from "@/lib/sources";
import type { EventDetail, EventVersion } from "@/types";

/** A direct source with one link and no file, changed by `overrides`. */
export const source = (overrides: Partial<Source> = {}): Source => ({
  id: "s1",
  title: "",
  level: "direct",
  kind: "unknown",
  captured_at: null,
  capture_position: null,
  is_graphic: false,
  links: [{ url: "https://t.me/channel/12345", posted_at: null, archived: null }],
  tags: [],
  media: null,
  warnings: [],
  ...overrides,
});

/** A geolocated event with every optional field empty and one URL-only source, for detail-panel
 *  tests. */
export const eventDetail = (id: string, title: string): EventDetail => ({
  id,
  title,
  coords: { lat: 49.71, lng: 37.616 },
  occurred_date: "2026-03-14",
  occurred_time: null,
  status: "geolocated",
  version_no: 1,
  is_graphic: false,
  close_reason: null,
  before_closed_status: null,
  detected_from_url: null,
  detected_via: null,
  owner: { id: "u1", username: "ana" },
  tags: [],
  conflicts: [],
  sources: [source()],
  proof: null,
  created_at: "2026-03-15T10:00:00Z",
  geolocated_at: "2026-03-15T10:00:00Z",
  closed_at: null,
  thumbnail: null,
  requested_by: null,
  geolocators: [],
});

/** One source as `services/versions.source_entry` files it in a snapshot. */
export const snapshotSource = (s: Source): Record<string, unknown> => ({
  title: s.title,
  level: s.level,
  kind: s.kind,
  captured_at: s.captured_at,
  capture_position: s.capture_position,
  is_graphic: s.is_graphic,
  links: s.links.map((l) => ({
    url: l.url,
    posted_at: l.posted_at,
    snapshot_url: l.archived?.url ?? null,
    archived_at: l.archived?.archived_at ?? null,
  })),
  tags: s.tags,
  media: s.media,
});

/** A filed version of `event` whose snapshot holds the event's own fields, changed by
 *  `overrides` (snapshot keys as `services/versions.build_snapshot` files them). */
export const filedVersion = (
  event: EventDetail,
  versionNo: number,
  overrides: Record<string, unknown> = {},
): EventVersion => ({
  id: `v${versionNo}`,
  version_no: versionNo,
  edited_by: null,
  note: null,
  created_at: "2026-03-16T10:00:00Z",
  redacted: false,
  snapshot: {
    title: event.title,
    coords: event.coords,
    occurred_date: event.occurred_date,
    occurred_time: event.occurred_time,
    sources: event.sources.map(snapshotSource),
    tags: event.tags,
    conflicts: event.conflicts,
    proof: event.proof,
    proof_media: [],
    ...overrides,
  },
});

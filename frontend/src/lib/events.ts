import { apiFetch } from "./api";
import type { components, operations } from "@/lib/api-types";
import { archiveTooLarge } from "./archive";
import { appendEventFilterParams, type EventFilterParams } from "./search";
import { cleanNumber, inBounds } from "./coordinates";
import { proofHasImage } from "./proof";
import { snapshotProvider } from "./snapshots";
import type { Source, SourceCreate } from "./sources";
import type {
  ArchiveImportJob,
  ArchiveImportPresign,
  EventDetail,
  EventVersion,
  Media,
  TweetImportOutcome,
} from "@/types";
import { withCursor } from "./pagination";
import { eventHref } from "./routes";

/** A required field a create/edit form is still missing; `key` drives the in-form highlight. */
export type MissingFieldKey =
  | "title"
  | "coordinates"
  | "source_file"
  | "source_link"
  | "source_kind"
  | "proof"
  | "proof_image"
  | "conflict_tag";

export interface MissingField {
  key: MissingFieldKey;
  label: string;
}

/** One label per field key, read by the validators. */
export const FIELD_LABELS: Record<MissingFieldKey, string> = {
  title: "Title",
  coordinates: "Coordinates",
  source_file: "Source file",
  source_link: "Source URL",
  source_kind: "Source kind",
  proof: "Proof",
  proof_image: "Proof image",
  conflict_tag: "Conflict",
};

/** Mirrors `models/source.MAX_SOURCES_PER_EVENT`; change both. */
export const MAX_SOURCES_PER_EVENT = 10;

/** Mirrors `models/source.MAX_LINKS_PER_SOURCE`; change both. */
export const MAX_LINKS_PER_SOURCE = 10;

/** Below the backend default (`per_page=20`, max 100) so row previews load faster. */
const DETECTIONS_PER_PAGE = 10;

/** Detections loaded per review session, stepped through locally so a published row
 *  leaving the queue can't shift the position. The backend caps lists at 100 rows. */
const DETECTIONS_REVIEW_QUEUE = 100;

/** Queue filter for `GET /events/detections`. Hand-written like `EventView` (the router
 *  takes a plain `str`). Mirrors `services/events/readiness.py` `DETECTION_READINESS`; change both. */
export type DetectionReadiness = "all" | "ready" | "incomplete";

/** Shape of `GET /events/detections`. `total` counts the set `readiness` selected;
 *  `ready_total` and `incomplete_total` count the whole queue under any filter. */
export type PaginatedEventDetails = Omit<
  components["schemas"]["PaginatedEventDetails"],
  "items"
> & { items: EventDetail[] };

export function detectionsPath(
  page = 1,
  perPage = DETECTIONS_PER_PAGE,
  readiness: DetectionReadiness = "all",
): string {
  return `/events/detections?page=${page}&per_page=${perPage}&readiness=${readiness}`;
}

export function detectionsReviewPath(): string {
  return detectionsPath(1, DETECTIONS_REVIEW_QUEUE);
}

/** Marks an edit URL as a step of a review pass; every hop carries it so the walk
 *  survives a reload and Back. */
export const QUEUE_PARAM = "queue";

export function detectionEditPath(id: string, inQueue = false): string {
  return `/events/${id}/edit${inQueue ? `?${QUEUE_PARAM}=1` : ""}`;
}

/** Read views over the `events` table. Mirrors `event_filters.VIEWS`; see
 *  `docs/data-model.md`. */
export type EventView = "located" | "requested";

/** `hasCoords` `true` keeps rows with a location (a request's guess), `false` the blind ones. */
export interface EventListParams extends EventFilterParams {
  view?: EventView;
  sort?: EventListSort;
  limit?: number;
  /** Cursor of the next page, from a `Link: rel="next"` header. */
  cursor?: string | null;
}

/** `GET /events?sort=`: `created_at` descending (`newest`, the server default) or ascending. */
export type EventListSort = NonNullable<
  NonNullable<operations["list_events_api_v1_events_get"]["parameters"]["query"]>["sort"]
>;

/** Build the `GET /events` query. The response caps at 100 rows; read further with the
 *  previous page's `cursor`. */
export function eventListPath(params: EventListParams = {}): string {
  const search = new URLSearchParams();
  if (params.view) search.set("view", params.view);
  appendEventFilterParams(search, params);
  if (params.sort) search.set("sort", params.sort);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return `/events${qs ? `?${qs}` : ""}`;
}

/** Optional subject-coordinate guess. Both-or-neither: a lone half is dropped, a non-numeric
 *  pair clears it. */
export function parseGuessCoords(
  latStr: string,
  lngStr: string
): { lat: number; lng: number } | Record<string, never> {
  const lat = cleanNumber(latStr);
  const lng = cleanNumber(lngStr);
  if (lat === null || lng === null) return {};
  return { lat, lng };
}

/** The fields every event write posts: the whole row state, its sources included. */
export interface EventWriteInput {
  title: string;
  /** The subject point; both halves or neither. Required on a geolocation write. */
  lat?: number;
  lng?: number;
  /** The whole source list, which replaces the stored one. */
  sources: SourceCreate[];
  /** ISO `YYYY-MM-DD`; omitted when unknown. */
  occurred_date?: string;
  /** Optional ISO `HH:MM`, UTC; omitted clears it. */
  occurred_time?: string;
  proof?: string | null;
  /** Replaces the tag set wholesale. */
  tag_ids: string[];
  /** Replaces the conflict set wholesale. */
  conflict_ids: string[];
  /** Inline proof images, uploaded with the write; matched to `placeholder://<filename>` srcs,
   *  which the server rewrites. */
  proof_files: File[];
}

/** The multipart body every event write posts. Source files never travel here: each one
 *  uploads first (`POST /uploads`) and the source names it. */
function eventFormData(input: EventWriteInput): FormData {
  const fd = new FormData();
  fd.append("title", input.title);
  // Both-or-neither, matching the backend.
  if (input.lat !== undefined && input.lng !== undefined) {
    fd.append("lat", String(input.lat));
    fd.append("lng", String(input.lng));
  }
  fd.append("sources", JSON.stringify(input.sources));
  if (input.occurred_date) fd.append("occurred_date", input.occurred_date);
  if (input.occurred_time) fd.append("occurred_time", input.occurred_time);
  if (input.proof) fd.append("proof", input.proof);
  if (input.tag_ids.length > 0) fd.append("tag_ids", JSON.stringify(input.tag_ids));
  if (input.conflict_ids.length > 0) {
    fd.append("conflict_ids", JSON.stringify(input.conflict_ids));
  }
  for (const file of input.proof_files) fd.append("proof_files", file);
  return fd;
}

/** The analysts a publish invites to share the credit, by username. Only the two publishing
 *  writes take them. */
function appendGeolocatorInvites(fd: FormData, usernames: string[] = []): void {
  if (usernames.length === 0) return;
  fd.append(
    "geolocator_invites",
    JSON.stringify(usernames.map((username) => ({ username }))),
  );
}

function postEventForm<T>(path: string, fd: FormData): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: fd });
}

/** Mirrors `schemas/event.VERSION_NOTE_MAX_LENGTH`; change both. */
export const VERSION_NOTE_MAX_LEN = 280;

/** `POST /events/{id}/versions`: publishes a request or a detection (version 0 becomes version
 *  1) or corrects a published event, filing the superseded state as a version. `note` is the
 *  editor's words about the edit, stored on it. `version_no` is the version the form was loaded
 *  at: a row that moved past it answers 409 `version_mismatch`. `geolocator_invites` rides on a
 *  publish only. */
export function saveVersion(
  id: string,
  input: EventWriteInput & { note?: string; version_no: number; geolocator_invites?: string[] }
): Promise<EventDetail> {
  const fd = eventFormData(input);
  if (input.note?.trim()) fd.append("note", input.note.trim());
  fd.append("version_no", String(input.version_no));
  appendGeolocatorInvites(fd, input.geolocator_invites);
  return postEventForm(`/events/${id}/versions`, fd);
}

// Version history: reads behind /events/{id}/history and /vN.

/** Cursor is the previous page's `Link: rel="next"` value, `null` for the first. */
export function eventVersionsPath(id: string, cursor: string | null): string {
  return withCursor(`/events/${id}/versions`, cursor);
}

export function eventVersionPath(id: string, versionNo: number): string {
  return `/events/${id}/versions/${versionNo}`;
}

/** Past versions only; the current one keeps `/events/{id}`. */
export function eventVersionHref(id: string, versionNo: number): string {
  return `${eventHref(id)}/v${versionNo}`;
}

export function eventHistoryHref(id: string): string {
  return `/events/${id}/history`;
}

/** Whether the row was ever published, retraction included. Asking this instead of
 *  `status === "geolocated"` keeps history reachable after a retraction. */
export function hasPublishedRecord(
  geo: Pick<EventDetail, "status" | "before_closed_status">
): boolean {
  return (
    geo.status === "geolocated" ||
    (geo.status === "closed" && geo.before_closed_status === "geolocated")
  );
}

/** Version number of a `vN` segment, or `null` (other shapes, so the route 404s). */
export function parseVersionSegment(segment: string): number | null {
  if (!/^v(0|[1-9][0-9]*)$/.test(segment)) return null;
  return Number(segment.slice(1));
}

/** The oldest version the event's history holds: 0 when it has a version 0 (the request or the
 *  detection it was published from), else 1. */
export function firstVersion(geo: Pick<EventDetail, "version_zero">): number {
  return geo.version_zero ? 0 : 1;
}

/** A version's short name: version 0 is the request or the detection, any other `vN`. */
export function versionLabel(
  geo: Pick<EventDetail, "version_zero">,
  number: number
): string {
  if (number === 0 && geo.version_zero) {
    return geo.version_zero === "request" ? "Request" : "Detection";
  }
  return `v${number}`;
}

/** One label per versioned field, in changed-list order. Keyed by the fields
 *  `services/versions.build_snapshot` files; `archives` is the sources' archived copies, named
 *  apart since a copy is recorded without changing what a source says. */
const VERSION_FIELD_LABELS = {
  title: "Title",
  sources: "Sources",
  coords: "Coordinates",
  occurred_date: "Event date",
  occurred_time: "Event time",
  conflicts: "Conflict",
  tags: "Tags",
  archives: "Archived copies",
  proof: "Proof",
} as const;

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asCoords = (value: unknown): EventDetail["coords"] => {
  if (value === null || typeof value !== "object") return null;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
};

const asList = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const asMedia = (value: unknown): Media | null =>
  value !== null && typeof value === "object" && typeof (value as Media).storage_url === "string"
    ? (value as Media)
    : null;

/** One snapshot source (`services/versions.source_entry`) in the read shape. The snapshot keeps
 *  no id, so the position stands in. Its graphic flag is ratcheted against the live source
 *  showing the same file, since the file shown is the live object. */
function snapshotSource(
  entry: Record<string, unknown>,
  index: number,
  versionNo: number,
  liveGraphicFiles: ReadonlySet<string>
): Source {
  const media = asMedia(entry.media);
  const level = entry.level;
  return {
    id: `v${versionNo}-${index}`,
    title: asString(entry.title, ""),
    level: level === "indirect" || level === "context" ? level : "direct",
    kind: (asNullableString(entry.kind) as Source["kind"] | null) ?? "unknown",
    captured_at: asNullableString(entry.captured_at),
    capture_position: asCoords(entry.capture_position),
    is_graphic:
      entry.is_graphic === true || (media !== null && liveGraphicFiles.has(media.storage_url)),
    links: asList<Record<string, unknown>>(entry.links).map((link) => {
      const snapshotUrl = asNullableString(link.snapshot_url);
      const provider = snapshotUrl ? snapshotProvider(snapshotUrl) : null;
      return {
        url: asString(link.url, ""),
        posted_at: asNullableString(link.posted_at),
        archived:
          snapshotUrl && provider
            ? {
                url: snapshotUrl,
                provider,
                archived_at: asNullableString(link.archived_at) ?? "",
              }
            : null,
      };
    }),
    tags: asList<Source["tags"][number]>(entry.tags),
    media,
    // A version shows what it said, not what the provider check says today.
    warnings: [],
  };
}

/** One filed version as the event shape every surface renders.
 *  Sources are read from the snapshot alone, never the live row, so the changed-field list sees
 *  different values across an edit. Identity (id, owner, status, creation date) comes from the
 *  current row, except version 0, which reads as the open request or detection it was. A conflict resolves to the live row when its id still exists, else the stored
 *  name, so a version survives a rename or delete.
 *  The snapshot is untyped JSON, so every field is read defensively; a redacted `{}` snapshot
 *  maps to the current row's immutables and empty content. */
export function snapshotToEventView(
  current: EventDetail,
  version: EventVersion
): EventDetail {
  const snapshot = version.snapshot;
  const conflictsById = new Map(current.conflicts.map((c) => [c.id, c]));
  const liveGraphicFiles = new Set(
    current.sources.flatMap((s) => (s.is_graphic && s.media ? [s.media.storage_url] : []))
  );
  const sources = asList<Record<string, unknown>>(snapshot.sources).map((entry, index) =>
    snapshotSource(entry, index, version.version_no, liveGraphicFiles)
  );
  return {
    ...current,
    version_no: version.version_no,
    sources,
    is_graphic: sources.some((s) => s.is_graphic),
    // As the server picks it: the first source file, else the first proof image.
    thumbnail:
      sources.find((s) => s.media)?.media ??
      asList<unknown>(snapshot.proof_media).map(asMedia).find((m) => m !== null) ??
      null,
    title: asString(snapshot.title, current.title),
    coords: asCoords(snapshot.coords),
    occurred_date: asNullableString(snapshot.occurred_date),
    occurred_time: asNullableString(snapshot.occurred_time),
    tags: asList<EventDetail["tags"][number]>(snapshot.tags),
    conflicts: asList<{ id: string; name: string }>(snapshot.conflicts).map(
      (stored) =>
        conflictsById.get(stored.id) ?? {
          id: stored.id,
          name: stored.name,
          is_ongoing: false,
          start_year: null,
          end_year: null,
          tier: null,
          wikidata_id: null,
        }
    ),
    proof: (snapshot.proof as string | null | undefined) ?? null,
    // Version 0 is the request or the detection as it stood before the publish.
    ...(version.version_no === 0 && current.version_zero
      ? {
          status: current.version_zero === "request" ? "requested" : "detected",
          before_closed_status: null,
          closed_at: null,
          close_reason: null,
        }
      : {}),
  };
}

/** Same moment whatever the spelling (`+00:00` vs `Z`); unparseable values stay as written. */
function instantKey(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return isNaN(parsed) ? value : String(parsed);
}

const sameCoords = (
  a: EventDetail["coords"],
  b: EventDetail["coords"]
): boolean => (a === null || b === null ? a === b : a.lat === b.lat && a.lng === b.lng);

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Same time to the minute: the API serves `HH:MM:SS`, the time input holds `HH:MM`. */
const sameTime = (a: string | null, b: string | null): boolean =>
  (a?.slice(0, 5) ?? null) === (b?.slice(0, 5) ?? null);

/** Same members in any order (the API serves tags and conflicts unordered). */
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  sameList([...a].sort(), [...b].sort());

/** Each source as a comparable value, archived copies left out. The file compares by its stored
 *  object, so a copied file reads the same as the one it copies. */
const sourceKeys = (view: EventDetail): string[] =>
  view.sources.map((s) =>
    JSON.stringify([
      s.title,
      s.level,
      s.kind,
      instantKey(s.captured_at),
      s.capture_position ? [s.capture_position.lat, s.capture_position.lng] : null,
      s.is_graphic,
      s.links.map((l) => `${l.url} ${instantKey(l.posted_at)}`).sort(),
      s.tags.map((t) => t.id).sort(),
      s.media?.storage_url ?? null,
    ])
  );

/** A version's archived copies as comparable (link, snapshot) pairs; the snapshot host implies
 *  the provider. */
const archivedPairs = (view: EventDetail): string[] =>
  view.sources.flatMap((s) =>
    s.links.flatMap((l) => (l.archived ? [`${l.url} ${l.archived.url}`] : []))
  );

/** Labels of the versioned fields that differ between a version and the one before it,
 *  computed client side from two adjacent views. Tags and conflicts compare by id, as
 *  sets; sources as a set of values. Inline images are not their own entry (they live in the
 *  proof). Archived copies compare as (link, snapshot) pairs. */
export function changedFields(version: EventDetail, previous: EventDetail): string[] {
  const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);
  const changed: string[] = [];
  const flag = (label: string, differs: boolean) => {
    if (differs) changed.push(label);
  };
  flag(VERSION_FIELD_LABELS.title, version.title !== previous.title);
  flag(VERSION_FIELD_LABELS.sources, !sameSet(sourceKeys(version), sourceKeys(previous)));
  flag(VERSION_FIELD_LABELS.coords, !sameCoords(version.coords, previous.coords));
  flag(VERSION_FIELD_LABELS.occurred_date, version.occurred_date !== previous.occurred_date);
  flag(
    VERSION_FIELD_LABELS.occurred_time,
    !sameTime(version.occurred_time, previous.occurred_time)
  );
  flag(
    VERSION_FIELD_LABELS.conflicts,
    !sameSet(ids(version.conflicts), ids(previous.conflicts))
  );
  flag(VERSION_FIELD_LABELS.tags, !sameSet(ids(version.tags), ids(previous.tags)));
  flag(
    VERSION_FIELD_LABELS.archives,
    !sameSet(archivedPairs(version), archivedPairs(previous))
  );
  flag(
    VERSION_FIELD_LABELS.proof,
    (version.proof ?? null) !== (previous.proof ?? null)
  );
  return changed;
}

/** The edit form's state as the strings its inputs carry (typed values, not posted values). */
export interface EventVersionFormState {
  title: string;
  /** Whether the posted source list would differ from the stored one (`sourcesChanged`). */
  sourcesMoved: boolean;
  lat: string;
  lng: string;
  eventDate: string;
  eventTime: string;
  proof: string | null;
  tagIds: string[];
  conflictIds: string[];
}

const coordsOf = (lat: string, lng: string): EventDetail["coords"] => {
  const [parsedLat, parsedLng] = [cleanNumber(lat), cleanNumber(lng)];
  return parsedLat === null || parsedLng === null ? null : { lat: parsedLat, lng: parsedLng };
};

/** Whether saving would file a version that differs from the one on screen. The server
 *  refuses the same edit with `nothing_changed` and is the authority (the row may have
 *  moved). Delegates to `changedFields` over a candidate built from the form, except the
 *  sources, which the caller compares (`sourcesChanged`): an upload has no stored value yet. */
export function hasVersionChanges(
  geo: EventDetail,
  state: EventVersionFormState
): boolean {
  if (state.sourcesMoved) return true;
  const candidate: EventDetail = {
    ...geo,
    title: state.title.trim(),
    coords: coordsOf(state.lat, state.lng),
    occurred_date: state.eventDate || null,
    occurred_time: state.eventTime || null,
    // Only the ids are compared, so the rest of each row is the loaded one.
    tags: state.tagIds.map((id) => ({ id })) as EventDetail["tags"],
    conflicts: state.conflictIds.map((id) => ({ id })) as EventDetail["conflicts"],
    proof: state.proof,
  };
  return changedFields(candidate, geo).length > 0;
}

/** Word for word the sentence `services/events.save_version` raises with
 *  `nothing_changed`; the form prefers the server's message when it has one. */
export const nothingChangedMessage = (versionNo: number): string =>
  `Nothing changed since version ${versionNo}.`;

export interface EventVersionEntry {
  /** Which version this is. `0` is the request or the detection the event was published from,
   *  `1` the record as it was published. */
  number: number;
  /** True for the live row, the one `/events/{id}` serves. */
  current: boolean;
  /** The event at this version, or `null` when redacted. */
  view: EventDetail | null;
  /** Who produced this version and when; `null` when the carrying row could not be read. */
  editor: EventDetail["owner"] | null;
  createdAt: string | null;
  /** That editor's own words about the edit, `null` when they left none. */
  note: string | null;
  redacted: boolean;
  /** Fields changed against the previous version; `null` when not comparable (the first
   *  version, or a redacted side). */
  changed: string[] | null;
}

/** Rows one version is assembled from. `own` is its content (absent for the live row);
 *  `producedBy` is the row numbered one lower, since the API files an edit's byline on the
 *  version it superseded; `previous` is that lower version's view, the diff base. */
export interface EventVersionEntryRows {
  own?: EventVersion | null;
  producedBy?: EventVersion | null;
  previous?: EventDetail | null;
}

/** One version, described by the edit that produced it. Content comes from row `n`,
 *  authorship from row `n - 1`. Version 0 was opened, not edited: it takes the requester (or
 *  the owner, for a detection) and `created_at`. Version 1 without a version 0 takes the
 *  publisher and `geolocated_at` (not `created_at`, which is when the record was opened). Any
 *  other version with no producing row states neither byline nor date rather than crediting
 *  the publication. */
export function eventVersion(
  current: EventDetail,
  number: number,
  { own = null, producedBy = null, previous = null }: EventVersionEntryRows = {}
): EventVersionEntry {
  const isCurrent = number === current.version_no;
  const view = isCurrent
    ? current
    : own && !own.redacted
      ? snapshotToEventView(current, own)
      : null;
  return {
    number,
    current: isCurrent,
    view,
    editor: producedBy
      ? producedBy.edited_by
      : number === 0
        ? current.version_zero === "request"
          ? current.requested_by
          : current.owner
        : number === 1 && !current.version_zero
          ? current.owner
          : null,
    createdAt: producedBy
      ? producedBy.created_at
      : number === 0
        ? current.created_at
        : number === 1 && !current.version_zero
          ? current.geolocated_at
          : null,
    note: producedBy?.note ?? null,
    redacted: own?.redacted ?? false,
    changed: view && previous ? changedFields(view, previous) : null,
  };
}

/** Versions newest first. While `hasMore`, the oldest loaded row is authorship for the
 *  version above it, so it is held back until the completing page arrives: no version
 *  number appears without an editor. */
export function eventVersions(
  current: EventDetail,
  rows: EventVersion[],
  hasMore = false
): EventVersionEntry[] {
  const byNumber = new Map(rows.map((row) => [row.version_no, row]));
  // `+ 1`: while paging, the lowest loaded row is only authorship for the version above, so
  // stop one above it. A finished walk reaches the first version.
  const first = firstVersion(current);
  const oldest = hasMore && rows.length > 0 ? Math.min(...byNumber.keys()) + 1 : first;

  // Diff base only; the content is the same snapshot.
  const viewOf = (number: number): EventDetail | null =>
    eventVersion(current, number, { own: byNumber.get(number) }).view;

  const entries: EventVersionEntry[] = [];
  for (let number = current.version_no; number >= oldest; number--) {
    const own = byNumber.get(number);
    if (number !== current.version_no && own === undefined) break;
    entries.push(
      eventVersion(current, number, {
        own,
        producedBy: byNumber.get(number - 1),
        previous: number > first ? viewOf(number - 1) : null,
      })
    );
  }
  return entries;
}

/** `POST /events` (multipart); returns the new id. */
export function createEvent(
  input: EventWriteInput & { geolocator_invites?: string[] }
): Promise<{ id: string }> {
  const fd = eventFormData(input);
  appendGeolocatorInvites(fd, input.geolocator_invites);
  return postEventForm("/events", fd);
}

/** Open a request: `POST /events/requests` (multipart). The coordinate guess is optional and
 *  the floor is a direct or indirect source with a file. */
export function createEventRequest(input: EventWriteInput): Promise<EventDetail> {
  return postEventForm("/events/requests", eventFormData(input));
}

/** Correct an open request: `POST /events/{id}/request`, owner-only, `requested`-only. No
 *  version is filed (a request is a question, not a vouched claim): the row is overwritten.
 *  Posting no guess clears it. */
export function updateEventRequest(id: string, input: EventWriteInput): Promise<EventDetail> {
  return postEventForm(`/events/${id}/request`, eventFormData(input));
}

/** `POST /events/import-from-tweet`: runs detection over one of your own X posts and
 *  returns the detections created, updated or left alone, plus warnings. */
export function importFromPost(url: string): Promise<TweetImportOutcome> {
  return apiFetch<TweetImportOutcome>("/events/import-from-tweet", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

/** Step 1: `POST /events/import-archive/presign` mints the staging key and a presigned upload target. */
export function presignArchiveUpload(): Promise<ArchiveImportPresign> {
  return apiFetch<ArchiveImportPresign>("/events/import-archive/presign", {
    method: "POST",
  });
}

/** The upload leg failed in transit; nothing is staged, so a retry is safe. Distinct from
 *  `archive_too_large`, which is terminal. */
export class ArchiveUploadError extends Error {
  constructor() {
    super("The upload didn't complete. Check your connection and try again.");
    this.name = "ArchiveUploadError";
  }
}

/** `detail` prefixes of the dev upload endpoint's 413s (`backend/app/main.py`): its size
 *  guard and the body-size middleware. */
const DEV_UPLOAD_TOO_LARGE_DETAILS = [
  "Upload exceeds the size guard",
  "Request body too large",
];

/** Whether a 413 came from the dev upload endpoint rather than an intermediary. */
function isDevUploadTooLarge(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const detail = (parsed as { detail?: unknown } | null)?.detail;
  if (typeof detail !== "string") return false;
  return DEV_UPLOAD_TOO_LARGE_DETAILS.some((prefix) => detail.startsWith(prefix));
}

/** Classify a non-2xx from the storage POST. An over-cap body is terminal (S3: 400
 *  `EntityTooLarge`; dev endpoint: 413). The 413 is matched on that endpoint's body, since
 *  a proxy can 413 an under-cap body and a retry would work. Everything else is transit. */
function uploadFailure(status: number, body: string): Error {
  const tooLarge =
    body.includes("<Code>EntityTooLarge</Code>") ||
    (status === 413 && isDevUploadTooLarge(body));
  return tooLarge ? archiveTooLarge() : new ArchiveUploadError();
}

/** Step 2: POST the stripped zip straight to storage. XHR for progress events; `fields`
 *  precede the file part (S3 ignores later ones); no credentials (the presigned policy
 *  authorizes). `onProgress` gets raw byte counts. */
export function uploadArchive(
  upload: ArchiveImportPresign["upload"],
  file: File,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) {
      fd.append(name, value);
    }
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", upload.url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(uploadFailure(xhr.status, xhr.responseText ?? ""));
    xhr.onerror = () => reject(new ArchiveUploadError());
    xhr.send(fd);
  });
}

/** Step 3: `POST /events/import-archive` verifies the staged object and enqueues the
 *  backfill (202, `queued`). The worker lands rows as `detected` and emails the outcome.
 *  `postEstimate` is the strip's cosmetic volume hint. */
export function enqueueArchiveImport(
  uploadKey: string,
  postEstimate: number
): Promise<ArchiveImportJob> {
  return apiFetch<ArchiveImportJob>("/events/import-archive", {
    method: "POST",
    body: JSON.stringify({ upload_key: uploadKey, estimated_post_count: postEstimate }),
  });
}

export function getImportJob(jobId: string): Promise<ArchiveImportJob> {
  return apiFetch<ArchiveImportJob>(`/events/import-archive/${jobId}`);
}

/** The poll gave up while the job may still land: lost sight, not failure. The completion
 *  email is the durable signal. */
export class ImportPollLost extends Error {}

/** Poll until the job is `done` or `failed`. Transient errors retry; `maxErrors`
 *  consecutive misses or `timeoutMs` throw `ImportPollLost`. */
export async function awaitImportJob(
  jobId: string,
  {
    intervalMs = 2500,
    maxErrors = 8,
    timeoutMs = 15 * 60_000,
    onUpdate,
  }: {
    intervalMs?: number;
    maxErrors?: number;
    timeoutMs?: number;
    /** Fires on every successful poll, for live progress. */
    onUpdate?: (job: ArchiveImportJob) => void;
  } = {}
): Promise<ArchiveImportJob> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveErrors = 0;
  for (;;) {
    try {
      const job = await getImportJob(jobId);
      consecutiveErrors = 0;
      onUpdate?.(job);
      if (job.status === "done" || job.status === "failed") return job;
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxErrors) {
        throw new ImportPollLost("import job polling lost after repeated errors");
      }
    }
    if (Date.now() >= deadline) {
      throw new ImportPollLost("import job polling timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Human labels of what stops a detection from publishing; empty means "ready" (only the
 *  conflict and source kind choices remain).
 *  Mirrors the server floor in `services/events/batch._publish_detection`, and only that:
 *  form-level requirements (title) are excluded. The server stays the authority.
 *  `services/events.detection_ready_predicate` is the SQL behind the queue's `readiness`
 *  filter; both are held to `backend/tests/events/_readiness_cases.py` and its mirror in
 *  `events.test.ts`. */
export function batchCompletionBlockers(geo: {
  coords: unknown | null;
  proof: string | null;
  sources: readonly Pick<Source, "level" | "links" | "media">[];
}): string[] {
  // In the server's check order.
  const missing: string[] = [];
  if (!geo.coords) missing.push(FIELD_LABELS.coordinates);
  // The leg the queue most often has to flag.
  if (!geo.proof || !proofHasImage(geo.proof)) missing.push(FIELD_LABELS.proof_image);
  if (geo.sources.some((s) => s.links.length === 0)) missing.push(FIELD_LABELS.source_link);
  if (!geo.sources.some((s) => s.level !== "context" && s.media !== null)) {
    missing.push(FIELD_LABELS.source_file);
  }
  return missing;
}

/** The label of the provenance link (`detected_from_url`). The bot writes that link on requests as
 *  well as detections; `requested_by` survives fulfilment, so a bot-opened request keeps its label
 *  once someone geolocates it. */
export function provenanceLabel(openedAsRequest: boolean): string {
  return openedAsRequest ? "Requested from" : "Detected from";
}

/** `POST /events/{id}/close`: withdraw a request, reject a detection, or retract a
 *  geolocation (owner-only). The reason is public, so required; closing is terminal. */
export function closeEvent(id: string, closeReason: string): Promise<EventDetail> {
  return apiFetch<EventDetail>(`/events/${id}/close`, {
    method: "POST",
    body: JSON.stringify({ close_reason: closeReason }),
  });
}

/** Report buckets, aliased from the generated spec so a backend rename fails `tsc`. */
export type ContentReportReason =
  components["schemas"]["ContentReportCreate"]["reason"];

/** One report as the admin queue reads it (`resolved_at === null` means open). */
export type ContentReport = components["schemas"]["ContentReportRead"];

/** Mirrors `schemas/report.DETAILS_MAX_LENGTH`; change both. */
export const REPORT_DETAILS_MAX_LEN = 2000;

/** One label per report bucket, shared by the report form and the admin queue. Keyed by the
 *  generated union so a new backend reason fails `tsc`. */
export const REPORT_REASON_LABELS: Record<ContentReportReason, string> = {
  illegal_content: "Illegal content",
  graphic_not_flagged: "Graphic content, not flagged",
  copyright: "Copyright",
  privacy: "Privacy",
  other: "Something else",
};

/** `POST /events/{id}/report`. Open to anyone: `apiFetch` omits the CSRF header with no
 *  session cookie. The backend caps it per IP. */
export function reportEvent(
  id: string,
  body: components["schemas"]["ContentReportCreate"]
): Promise<ContentReport> {
  return apiFetch<ContentReport>(`/events/${id}/report`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** What a form's source editors hold against the floor (`sourceFloor`). */
export interface SourceFloorState {
  /** A direct or indirect source carries a file. */
  hasEvidenceFile: boolean;
  /** Some source has no URL. */
  missingLink: boolean;
  /** Some source names no kind. */
  missingKind: boolean;
}

/** Raw input values a geolocation form validates before submit. */
export interface EventFieldsState {
  title: string;
  lat: string;
  lng: string;
  proof: string | null;
  sources: SourceFloorState;
  hasConflict: boolean;
}

/** Every unmet required field for a geolocation, all at once: `label` for
 *  `IncompleteFormNotice`, `key` for the highlight. Mirrors the backend evidence floor
 *  (`docs/api.md#evidence-floor`). Proof must carry an image (`proofHasImage`): text alone
 *  can't be audited. */
export function missingEventFields(s: EventFieldsState): MissingField[] {
  // Strict parse like `cleanNumber`: `"48.85abc"` is missing, not truncated to 48.85.
  const lat = cleanNumber(s.lat);
  const lng = cleanNumber(s.lng);
  const coordsValid = lat !== null && lng !== null && inBounds(lat, lng);

  const missing: MissingField[] = [];
  const add = (key: MissingFieldKey) => missing.push({ key, label: FIELD_LABELS[key] });
  if (!s.title.trim()) add("title");
  if (!coordsValid) add("coordinates");
  if (!s.sources.hasEvidenceFile) add("source_file");
  if (s.sources.missingLink) add("source_link");
  if (s.sources.missingKind) add("source_kind");
  // "Proof" (none) and "Proof image" (text-only) are distinct misses.
  if (!s.proof) add("proof");
  else if (!proofHasImage(s.proof)) add("proof_image");
  if (!s.hasConflict) add("conflict_tag");
  return missing;
}

/** The unmet fields as a submit button's count badge names them: `2 missing: Title, Conflict`. */
export function missingSummary(missing: readonly { label: string }[]): string {
  return `${missing.length} missing: ${missing.map((m) => m.label).join(", ")}`;
}

/** Every unmet required field for a request: a title, and a direct or indirect source with a
 *  file, every source with a URL and a kind. Mirrors `POST /events/requests`. */
export function missingEventRequestFields(s: {
  title: string;
  sources: SourceFloorState;
}): MissingField[] {
  const missing: MissingField[] = [];
  const add = (key: MissingFieldKey) => missing.push({ key, label: FIELD_LABELS[key] });
  if (!s.title.trim()) add("title");
  if (!s.sources.hasEvidenceFile) add("source_file");
  if (s.sources.missingLink) add("source_link");
  if (s.sources.missingKind) add("source_kind");
  return missing;
}

import { ApiError, apiFetch, errorMessage } from "./api";
import type { components } from "./api-types";
import { coordinatePair, LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN } from "./coordinates";
import type { SourceFloorState } from "./events";
import { safeHostname, toDatetimeLocalUTC } from "./format";
import type { FieldName } from "./fieldHelp";
import type { ArchivedLink, Media } from "@/types";

/** One source of an event, in the event's source order. */
export type Source = components["schemas"]["SourceRead"];
type SourceLink = components["schemas"]["SourceLinkRead"];
/** A staged source file (`POST /uploads`), referenced by a source's `upload_id`. */
export type Upload = components["schemas"]["UploadRead"];
type UploadList = components["schemas"]["UploadList"];
type LinkUpload = components["schemas"]["LinkUploadRead"];
export type SourceLevel = Source["level"];
export type SourceKind = Source["kind"];
/** `POST /sources/check`: the provider each link opens. */
export type SourceCheck = components["schemas"]["SourceCheckRead"];
export type ImageryProvider = components["schemas"]["ImageryProviderRead"];
type ImageryKind = components["schemas"]["SourceCheck"]["kind"];

/** Each source field's name and `?`, for the source block's rows and the editor's labels. The
 *  key order is the order both read in; the block has no file row and no graphic row. */
export const SOURCE_FIELDS = {
  file: { label: "File", concept: "source_file" },
  title: { label: "Title" },
  level: { label: "Level", concept: "source_level" },
  kind: { label: "Kind", concept: "source_kind" },
  links: { label: "Links", concept: "source_links" },
  posted: { label: "Posted" },
  captured_at: { label: "Captured", concept: "captured_at" },
  capture_position: { label: "Capture position", concept: "capture_position" },
  tags: { label: "Tags" },
  is_graphic: { label: "Graphic content", concept: "graphic_content" },
} as const satisfies Record<string, FieldName>;

/** A source's name by its position in the event ("Source 2"). */
export const sourceName = (index: number): string => `Source ${index + 1}`;

/** Keyed by the generated union, so a level the backend adds fails the type-check. */
export const LEVEL_LABELS: Record<SourceLevel, string> = {
  direct: "Direct",
  indirect: "Indirect",
  context: "Context",
};

/** In the order the API serves sources. */
export const SOURCE_LEVELS = Object.keys(LEVEL_LABELS) as SourceLevel[];

/** Keyed by the generated union. Mirrors `models/source.EVIDENCE_LEVELS`; change both. */
const EVIDENCE_LEVELS: Record<SourceLevel, boolean> = {
  direct: true,
  indirect: true,
  context: false,
};

/** Whether a source of this level supports a publication: the evidence floor counts it. */
export const isEvidenceLevel = (level: SourceLevel): boolean => EVIDENCE_LEVELS[level];

/** Mirrors `models/source.MAX_SOURCES_PER_EVENT`; change both. */
export const MAX_SOURCES_PER_EVENT = 10;

/** Mirrors `models/source.MAX_LINKS_PER_SOURCE`; change both. */
export const MAX_LINKS_PER_SOURCE = 10;

/** Mirrors `models/source.SOURCE_TITLE_MAX_LENGTH`; change both. */
export const SOURCE_TITLE_MAX_LEN = 255;

/** Caps a link's URL and its snapshot URL. Mirrors `models/source.SOURCE_URL_MAX_LENGTH`;
 *  change both. */
export const SOURCE_URL_MAX_LEN = 2000;

/** Keyed by the generated union, so a kind the backend adds fails the type-check. */
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  smartphone: "Smartphone",
  camera: "Camera",
  static_camera: "Static camera",
  drone: "Drone",
  aircraft: "Aircraft",
  satellite: "Satellite",
  dashcam: "Dashcam",
  body_cam: "Body / helmet cam",
  article: "Article",
  official_statement: "Official statement",
  other: "Other",
  unknown: "Unknown",
};

export const SOURCE_KINDS = Object.keys(SOURCE_KIND_LABELS) as SourceKind[];

/** The kinds that are documents, not captures: they carry no capture position. Mirrors
 *  `models/source.DOCUMENT_SOURCE_KINDS`; change both. */
const DOCUMENT_SOURCE_KINDS: ReadonlySet<SourceKind | ""> = new Set<SourceKind>([
  "article",
  "official_statement",
  "other",
]);

/** Keyed by the generated union of the kinds the provider check covers. */
const IMAGERY_KINDS: Record<ImageryKind, true> = { satellite: true, aircraft: true };

/** Whether the imagery provider check covers a source of this kind. */
export const isImageryKind = (kind: SourceKind | ""): kind is ImageryKind => kind in IMAGERY_KINDS;

/** Whether a source of this kind can carry a capture position. */
export const hasCapturePosition = (kind: SourceKind | ""): boolean =>
  !DOCUMENT_SOURCE_KINDS.has(kind);

/** The first URL of an event's sources, for the one-host labels of a row or card. */
export function firstSourceUrl(event: { sources: Pick<Source, "links">[] }): string | null {
  return event.sources.flatMap((s) => s.links)[0]?.url ?? null;
}

const FILE_KIND_LABELS: Record<Media["kind"], string> = { image: "photo", video: "video" };

/** A source's kind as a reading surface prints it, with its file's kind when it has a file:
 *  `Drone · video`, `Article`. `unknown` tells the reader nothing, so it is dropped: the file's
 *  kind alone, or null without a file. */
export function sourceKindLabel(source: Pick<Source, "kind" | "media">): string | null {
  const file = source.media ? FILE_KIND_LABELS[source.media.kind] : null;
  if (source.kind === "unknown") return file ? file[0].toUpperCase() + file.slice(1) : null;
  const kind = SOURCE_KIND_LABELS[source.kind];
  return file ? `${kind} · ${file}` : kind;
}

/** One entry of an event write's `sources` JSON field, every field posted. */
export type SourceCreate = Required<components["schemas"]["SourceCreate"]>;

/** `kinds` stays empty until the post answers. */
export interface LinkPost {
  url: string;
  index: number;
  kinds: LinkUpload["post_media"];
}

/** A source file in a form. `stored` names the source's own stored file and posts `media_id`;
 *  `staged` posts `upload_id`, with the post it came from when it was imported from a link, or
 *  the URL of the proof image it was copied from. `failed` names the picked file, the link's
 *  host or the proof image. */
export type SourceFile =
  | { state: "stored"; media: Media }
  | { state: "uploading"; file: File; token: number }
  | { state: "importing"; post: LinkPost; token: number }
  | { state: "copying"; proof: string; token: number }
  | { state: "staged"; upload: Upload; post?: LinkPost; proof?: string }
  | { state: "failed"; name: string; error: string };

/** Whether a source file is still on its way to the server: the write waits for it. */
export const fileRunning = (
  file: SourceFile | null
): file is Extract<SourceFile, { token: number }> =>
  file?.state === "uploading" || file?.state === "importing" || file?.state === "copying";

/** One link row as the form holds it: input strings, plus the stored values an untouched input
 *  posts back at full precision. */
export interface LinkDraft {
  url: string;
  /** `datetime-local` value, UTC. */
  postedAt: string;
  /** The archived copy posted back as `snapshot_url`: the stored one until replaced. */
  snapshotUrl: string;
  /** What the link held when the form loaded, or null for a new row. */
  stored: { url: string; postedAt: string | null; archived: ArchivedLink | null } | null;
}

/** One source editor's state. */
export interface SourceDraft {
  /** React key; stable across reorders. */
  key: string;
  /** A stored source of this event, updated in place; null creates one. */
  id: string | null;
  title: string;
  level: SourceLevel;
  /** `""` until the analyst picks one, which the write posts as `unknown`. */
  kind: SourceKind | "";
  /** `datetime-local` value, UTC. */
  capturedAt: string;
  /** The stored instant, posted back when the input still holds its seed. */
  storedCapturedAt: string | null;
  captureLat: string;
  captureLng: string;
  isGraphic: boolean;
  /** The stored source is flagged: only an admin clears it. */
  graphicLocked: boolean;
  links: LinkDraft[];
  tagIds: string[];
  file: SourceFile | null;
}

let keyCounter = 0;
const nextKey = () => `source-${++keyCounter}`;

const blankLink = (): LinkDraft => ({ url: "", postedAt: "", snapshotUrl: "", stored: null });

/** The editor a form starts with, and the one **Add a source** appends. */
export function newSourceDraft(): SourceDraft {
  return {
    key: nextKey(),
    id: null,
    title: "",
    level: "direct",
    kind: "",
    capturedAt: "",
    storedCapturedAt: null,
    captureLat: "",
    captureLng: "",
    isGraphic: false,
    graphicLocked: false,
    links: [blankLink()],
    tagIds: [],
    file: null,
  };
}

const RELOADED_UPLOAD = "The page reloaded before this file finished uploading. Pick it again.";
const EXPIRED_UPLOAD = "This file's upload expired. Pick it again.";

/** An editor a reload restores from its stored draft: a fresh key, since the key counter starts
 *  over, and a file that cannot stand any more turned into a refusal the slot prints. A request
 *  the reload cut, or a staged upload past its expiry, needs a new pick. */
export function restoredSourceDraft(draft: SourceDraft, now: number): SourceDraft {
  const { file } = draft;
  let restored = file;
  if (fileRunning(file)) {
    const name =
      file.state === "uploading"
        ? file.file.name
        : file.state === "importing"
          ? safeHostname(file.post.url)
          : "Proof image";
    restored = { state: "failed", name, error: RELOADED_UPLOAD };
  } else if (file?.state === "staged" && Date.parse(file.upload.expires_at) <= now) {
    restored = { state: "failed", name: file.upload.original_filename ?? "File", error: EXPIRED_UPLOAD };
  }
  return { ...draft, key: nextKey(), file: restored };
}

function linkDraftsOf(links: SourceLink[]): LinkDraft[] {
  return links.map((link) => ({
    url: link.url,
    postedAt: toDatetimeLocalUTC(link.posted_at),
    snapshotUrl: link.archived?.url ?? "",
    stored: { url: link.url, postedAt: link.posted_at, archived: link.archived },
  }));
}

function draftFields(source: Source) {
  return {
    title: source.title,
    level: source.level,
    kind: source.kind,
    capturedAt: toDatetimeLocalUTC(source.captured_at),
    storedCapturedAt: source.captured_at,
    captureLat: source.capture_position ? String(source.capture_position.lat) : "",
    captureLng: source.capture_position ? String(source.capture_position.lng) : "",
    tagIds: source.tags.map((t) => t.id),
  };
}

/** An editor seeded from a stored source of the event the form writes. */
export function sourceDraftFrom(source: Source): SourceDraft {
  return {
    key: nextKey(),
    id: source.id,
    ...draftFields(source),
    isGraphic: source.is_graphic,
    graphicLocked: source.is_graphic,
    links: source.links.length > 0 ? linkDraftsOf(source.links) : [blankLink()],
    file: source.media ? { state: "stored", media: source.media } : null,
  };
}

/** The draft's file as the write names it, or null for none (an upload still running or a
 *  failed one names none). */
function fileReference(file: SourceFile | null): Pick<SourceCreate, "upload_id" | "media_id"> {
  return {
    media_id: file?.state === "stored" ? file.media.id : null,
    upload_id: file?.state === "staged" ? file.upload.id : null,
  };
}

/** A file that is, or is becoming, the source's: a running upload counts, so the publish counts do
 *  not flicker while it runs. `uploadsRunning` holds the write until it lands. */
const holdsFile = (draft: SourceDraft): boolean =>
  draft.file !== null && draft.file.state !== "failed";

/** The editors against the evidence floor (`missingEventFields`). */
export function sourceFloor(drafts: SourceDraft[]): SourceFloorState {
  return {
    hasEvidenceFile: drafts.some((d) => isEvidenceLevel(d.level) && holdsFile(d)),
    missingLink: drafts.some((d) => draftUrls(d).length === 0),
  };
}

/** Whether a source file is still uploading or importing: the write waits for it. */
export function uploadsRunning(drafts: SourceDraft[]): boolean {
  return drafts.some((d) => fileRunning(d.file));
}

export const UPLOADS_RUNNING_MESSAGE = "Wait for the source files to finish uploading.";

/** A `datetime-local` value as the API reads it (UTC), or the stored instant when the input
 *  still holds what it was seeded with, so an untouched field keeps its seconds. */
function instant(input: string, stored: string | null): string | null {
  if (stored !== null && input === toDatetimeLocalUTC(stored)) return stored;
  return input || null;
}

/** The URLs a draft posts: trimmed, blanks and repeats dropped, as the server counts them. */
export function draftUrls(draft: SourceDraft): string[] {
  return [...new Set(draft.links.map((l) => l.url.trim()).filter(Boolean))];
}

/** Whether the editor holds a capture position that is not a valid pair: half-typed,
 *  malformed or out of bounds. The write drops it, so the editor flags it. */
export function capturePositionInvalid(draft: SourceDraft): boolean {
  if (!hasCapturePosition(draft.kind)) return false;
  if (draft.captureLat.trim() === "" && draft.captureLng.trim() === "") return false;
  return coordinatePair(draft.captureLat, draft.captureLng) === null;
}

/** One editor as the write posts it. A draft with no kind posts `unknown`. */
export function sourceCreatePayload(draft: SourceDraft): SourceCreate {
  const file = fileReference(draft.file);
  const kind = draft.kind || "unknown";
  const seen = new Set<string>();
  const links: SourceCreate["links"] = [];
  for (const link of draft.links) {
    const url = link.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const sameLink = link.stored?.url === url;
    links.push({
      url,
      posted_at: instant(link.postedAt, sameLink ? (link.stored?.postedAt ?? null) : null),
      snapshot_url: link.snapshotUrl.trim() || null,
    });
  }
  return {
    id: draft.id,
    title: draft.title.trim(),
    level: draft.level,
    kind,
    captured_at: instant(draft.capturedAt, draft.storedCapturedAt),
    // A half-typed, malformed or out-of-bounds pair is dropped rather than refused, and the
    // editor flags it (`capturePositionInvalid`). A document kind posts none.
    capture_position: hasCapturePosition(kind)
      ? coordinatePair(draft.captureLat, draft.captureLng)
      : null,
    is_graphic: draft.isGraphic,
    links,
    tag_ids: draft.tagIds,
    ...file,
  };
}

/** The editors whose post would differ from the stored list. A copied or uploaded file, a new,
 *  removed or moved source, or any changed field counts. Archived copies count too, since a
 *  pasted copy is an edit. */
export function sourcesChanged(stored: Source[], drafts: SourceDraft[]): boolean {
  if (stored.length !== drafts.length) return true;
  return drafts.some((draft, index) => {
    const source = stored[index];
    if (draft.id !== source.id) return true;
    const posted = sourceCreatePayload(draft);
    if (posted.media_id !== (source.media?.id ?? null) || posted.upload_id) return true;
    if (fileRunning(draft.file) || draft.file?.state === "failed") return true;
    const position = source.capture_position;
    const samePosition =
      position === null
        ? posted.capture_position === null
        : posted.capture_position?.lat === position.lat &&
          posted.capture_position?.lng === position.lng;
    const storedLinks = source.links.map((l) => `${l.url} ${l.posted_at} ${l.archived?.url ?? ""}`);
    const postedLinks = posted.links.map(
      (l) => `${l.url} ${l.posted_at} ${l.snapshot_url ?? ""}`,
    );
    return (
      posted.title !== source.title ||
      posted.level !== source.level ||
      posted.kind !== source.kind ||
      posted.captured_at !== source.captured_at ||
      !samePosition ||
      // The flag only rises on a stored source.
      (posted.is_graphic && !source.is_graphic) ||
      [...storedLinks].sort().join("\n") !== [...postedLinks].sort().join("\n") ||
      [...source.tags.map((t) => t.id)].sort().join() !== [...posted.tag_ids].sort().join()
    );
  });
}

/** `POST /uploads`: stage one source file before the event write that names it. A GIF stages
 *  one PNG per frame, in frame order. */
export async function uploadSourceFile(file: File): Promise<Upload[]> {
  const fd = new FormData();
  fd.append("file", file);
  return (await apiFetch<UploadList>("/uploads", { method: "POST", body: fd })).items;
}

const X_HOST_RE = /^(?:www\.)?(?:x|twitter)\.com$/i;
const X_STATUS_PATH_RE = /^\/(?:\w+\/status|i\/web\/status)\/\d+/i;
const TELEGRAM_HOST_RE = /^(?:www\.)?t\.me$/i;
const TELEGRAM_POST_PATH_RE = /^\/[A-Za-z0-9_]{1,64}\/\d{1,19}$/;
const TIKTOK_HOST_RE = /^(?:www\.|m\.)?tiktok\.com$/i;
const TIKTOK_SHORT_HOST_RE = /^v[mt]\.tiktok\.com$/i;
const TIKTOK_POST_PATH_RE = /^\/@[A-Za-z0-9_.]{1,64}\/(?:video|photo)\/\d{1,25}\/?$/;
const TIKTOK_SHORT_PATH_RE = /^\/[A-Za-z0-9]{1,32}\/?$/;
const TIKTOK_T_PATH_RE = /^\/t\/[A-Za-z0-9]{1,32}\/?$/;

/** Mirrors backend `tweet_ingest/urls.is_importable_link`; change both. */
export function isImportableLink(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  const { hostname: host, pathname: path } = parsed;
  if (X_HOST_RE.test(host)) return X_STATUS_PATH_RE.test(path);
  const plain =
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    !parsed.username &&
    !parsed.password &&
    !parsed.port;
  if (!plain) return false;
  if (TELEGRAM_HOST_RE.test(host)) return TELEGRAM_POST_PATH_RE.test(path);
  if (TIKTOK_SHORT_HOST_RE.test(host)) return TIKTOK_SHORT_PATH_RE.test(path);
  if (TIKTOK_HOST_RE.test(host)) return TIKTOK_POST_PATH_RE.test(path) || TIKTOK_T_PATH_RE.test(path);
  return false;
}

export function importSourceFile(url: string, index: number): Promise<LinkUpload> {
  return apiFetch<LinkUpload>("/uploads/from-link", {
    method: "POST",
    body: JSON.stringify({ url, index }),
  });
}

/** The stored proof images of the event a form edits: its id and their URLs, in proof order. */
export interface ProofImages {
  eventId: string;
  urls: string[];
}

/** The proof images an editor offers for its slot: while no direct or indirect source holds a
 *  file, on a direct or indirect editor, and on the editor holding a copied one, to pick
 *  another. */
export function proofImagesFor(
  draft: SourceDraft,
  drafts: SourceDraft[],
  proofImages: ProofImages | undefined
): string[] {
  if (!proofImages) return [];
  const copied = draft.file?.state === "copying" || (draft.file?.state === "staged" && !!draft.file.proof);
  const gap = isEvidenceLevel(draft.level) && !sourceFloor(drafts).hasEvidenceFile;
  return copied || gap ? proofImages.urls : [];
}

/** `POST /uploads/from-proof`: stage a copy of a stored proof image as a source file. */
export function stageProofImage(eventId: string, url: string): Promise<Upload> {
  return apiFetch<Upload>("/uploads/from-proof", {
    method: "POST",
    body: JSON.stringify({ event_id: eventId, url }),
  });
}

/** `POST /sources/check` for an editor of an imagery kind: what the source would read once
 *  saved, from the fields the check reads. */
export function checkSource(draft: SourceDraft & { kind: ImageryKind }): Promise<SourceCheck> {
  const { captured_at, links } = sourceCreatePayload(draft);
  return apiFetch<SourceCheck>("/sources/check", {
    method: "POST",
    body: JSON.stringify({
      kind: draft.kind,
      captured_at,
      links: links.map(({ url, snapshot_url }) => ({ url, snapshot_url })),
    }),
  });
}

/** The form sentence for each source error code an event write can answer. Mirrors the codes of
 *  backend `services/events/errors` and `services/uploads`; change both. */
const SOURCE_ERROR_MESSAGES: Record<string, string> = {
  source_required: "Add a direct or indirect source.",
  source_file_required: "Add a file to a direct or indirect source.",
  source_link_required: "Every source needs at least one URL.",
  invalid_source_url: "A source URL is not a valid http or https link.",
  too_many_sources: `An event holds at most ${MAX_SOURCES_PER_EVENT} sources.`,
  too_many_source_links: `A source holds at most ${MAX_LINKS_PER_SOURCE} URLs.`,
  invalid_coordinates: `A position is out of range: latitude runs from ${LAT_MIN} to ${LAT_MAX}, longitude from ${LNG_MIN} to ${LNG_MAX}.`,
  source_not_found: "A source changed since this form loaded. Reload the page and try again.",
  source_media_not_found:
    "A source file changed since this form loaded. Reload the page and try again.",
  upload_not_found: "A source file upload was not found. Remove the file and upload it again.",
  upload_expired: "A source file upload expired. Remove the file and upload it again.",
  too_many_uploads:
    "You have too many source files waiting to be used. Submit the forms that use them, or wait a day for them to expire.",
  conflict_required: "Pick at least one conflict.",
};

/** A `useMutation` `onError` for every event write: a source error code reads as its form
 *  sentence; anything else keeps the server's message. */
export function sourceWriteError(err: unknown): string | undefined {
  if (err instanceof ApiError && err.code && err.code in SOURCE_ERROR_MESSAGES) {
    return SOURCE_ERROR_MESSAGES[err.code];
  }
  return undefined;
}

/** A source upload's refusal as the file slot prints it. */
export function uploadError(err: unknown): string {
  if (err instanceof ApiError && err.code === "too_many_uploads") {
    return SOURCE_ERROR_MESSAGES.too_many_uploads;
  }
  return errorMessage(err, "The upload failed. Try again.");
}

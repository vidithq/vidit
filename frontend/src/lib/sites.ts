import { apiFetch } from "./api";
import type { components } from "./api-types";
import { sourceCreatePayload, draftUrls, newSourceDraft, type SourceDraft } from "./sources";

export type Site = components["schemas"]["SiteRead"];
export type SiteCreated = components["schemas"]["SiteCreatedRead"];
export type SiteListItem = components["schemas"]["SiteList"];
export type SiteImage = components["schemas"]["SiteImageRead"];
export type SiteImageFiled = components["schemas"]["SiteImageFiledRead"];
export type SiteImageCreate = components["schemas"]["SiteImageCreate"];
export type SiteContour = components["schemas"]["SiteContourRead"];
export type SiteLinkedEvent = components["schemas"]["SiteLinkedEventRead"];
export type SiteOverlap = components["schemas"]["SiteOverlapRead"];
export type SiteSuggestion = components["schemas"]["SiteSuggestionRead"];
export type EventSiteLink = components["schemas"]["EventSiteLinkRead"];
export type Zone = components["schemas"]["ZonePolygon"];
export type SiteHistoryEntry = components["schemas"]["SiteHistoryEntry"];

export type SiteKind = Site["kind"];
export type LinkEffect = EventSiteLink["effect"];

/** Mirrors backend `models/event.TITLE_MAX_LENGTH`, the cap on a site name; change both. */
export const SITE_NAME_MAX_LEN = 255;
/** Mirrors backend `schemas/site.IMAGE_NOTE_MAX_LENGTH`; change both. */
export const SITE_IMAGE_NOTE_MAX_LEN = 500;
/** Mirrors the `margin_m` default (2000 m) of backend `routers/events/sites`; change both. */
export const SITE_MARGIN_KM = 2;

/** Keyed by the generated union, so a kind the backend adds fails the type-check. */
export const SITE_KIND_LABELS: Record<SiteKind, string> = {
  airbase: "Airbase",
  military_base: "Military base",
  depot: "Depot",
  port: "Port",
  air_defence_position: "Air defence position",
  artillery_position: "Artillery position",
  radar: "Radar",
  fortification: "Fortification",
  unknown: "Unknown",
  other: "Other",
};

export const SITE_KINDS = Object.keys(SITE_KIND_LABELS) as SiteKind[];

/** Keyed by the generated union, in the order the link dialog offers them. */
export const LINK_EFFECT_LABELS: Record<LinkEffect, string> = {
  damage: "Damage",
  destruction: "Destruction",
  activity: "Activity",
  other: "Other",
};

export const LINK_EFFECTS = Object.keys(LINK_EFFECT_LABELS) as LinkEffect[];

export function siteHref(id: string): string {
  return `/sites/${encodeURIComponent(id)}`;
}

export const NEW_SITE_HREF = "/sites/new";

export function siteFileImageHref(id: string): string {
  return `${siteHref(id)}/images/new`;
}

/** The owner's contour editor, starting from `imageId` when given. */
export function siteContourHref(id: string, imageId?: string): string {
  const base = `${siteHref(id)}/contour`;
  return imageId ? `${base}?image=${encodeURIComponent(imageId)}` : base;
}

export function sitesPath(bbox: string, asOf: string | null): string {
  const params = new URLSearchParams({ bbox });
  if (asOf) params.set("as_of", asOf);
  return `/sites?${params.toString()}`;
}

export function sitePath(id: string): string {
  return `/sites/${encodeURIComponent(id)}`;
}

export function siteHistoryPath(id: string): string {
  return `${sitePath(id)}/history`;
}

export function eventSiteLinksPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}/site-links`;
}

export function siteSuggestionsPath(eventId: string, q: string): string {
  const base = `/events/${encodeURIComponent(eventId)}/site-suggestions`;
  const query = q.trim();
  return query ? `${base}?${new URLSearchParams({ q: query }).toString()}` : base;
}

export function createSite(body: components["schemas"]["SiteCreate"]): Promise<SiteCreated> {
  return apiFetch<SiteCreated>("/sites", { method: "POST", body: JSON.stringify(body) });
}

export function updateSite(
  id: string,
  body: components["schemas"]["SiteUpdate"],
): Promise<Site> {
  return apiFetch<Site>(sitePath(id), { method: "PATCH", body: JSON.stringify(body) });
}

export function checkOverlaps(zone: Zone, signal?: AbortSignal): Promise<SiteOverlap[]> {
  return apiFetch<SiteOverlap[]>("/sites/overlaps", {
    method: "POST",
    body: JSON.stringify({ zone }),
    signal,
  });
}

export function fileSiteImage(siteId: string, body: SiteImageCreate): Promise<SiteImageFiled> {
  return apiFetch<SiteImageFiled>(`${sitePath(siteId)}/images`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function drawSiteContour(siteId: string, zone: Zone, imageId: string): Promise<SiteContour> {
  return apiFetch<SiteContour>(`${sitePath(siteId)}/contours`, {
    method: "POST",
    body: JSON.stringify({ zone, image_id: imageId }),
  });
}

export function reportSite(
  id: string,
  body: components["schemas"]["ContentReportCreate"],
): Promise<components["schemas"]["ContentReportRead"]> {
  return apiFetch(`${sitePath(id)}/report`, { method: "POST", body: JSON.stringify(body) });
}

/** Idempotent: the same effect again writes nothing, a new one replaces the live link. */
export function linkEventToSite(
  eventId: string,
  siteId: string,
  effect: LinkEffect,
): Promise<EventSiteLink> {
  return apiFetch<EventSiteLink>(eventSiteLinksPath(eventId), {
    method: "POST",
    body: JSON.stringify({ site_id: siteId, effect }),
  });
}

export function unlinkEventFromSite(eventId: string, siteId: string): Promise<void> {
  return apiFetch<void>(`${eventSiteLinksPath(eventId)}/${encodeURIComponent(siteId)}`, {
    method: "DELETE",
  });
}

/** The date the map asks the zones for: the end of the event date window, so moving it
 *  shows the zone valid then. No end, or an end past today, reads as today (`null`, the
 *  API default). Both dates are `YYYY-MM-DD`, which compare as strings. */
export function sitesAsOf(eventTo: string, today: string): string | null {
  return eventTo && eventTo < today ? eventTo : null;
}

/** Today in UTC as `YYYY-MM-DD`, the clock the API refuses a later capture date against. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The UTC day of an instant, `YYYY-MM-DD`: the unit the zone rule reads a capture date in. */
export function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** "640 m" under a kilometre, "2.4 km" from there. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** Whether the viewer owns the site: the one reader who renames it and draws its contour. */
export function ownsSite(site: Pick<Site, "owner">, viewerId: string | null | undefined): boolean {
  return !!viewerId && site.owner.id === viewerId;
}

// The order the zone rule reads contours in: the image's capture time, the later contour
// breaking a tie.
function contourKey(contour: SiteContour): string {
  return `${contour.captured_at} ${contour.created_at}`;
}

function contourOrder(contours: SiteContour[]): SiteContour[] {
  return [...contours].sort((a, b) => contourKey(a).localeCompare(contourKey(b)));
}

/** The contour valid on a day (`YYYY-MM-DD`): the latest one whose image was captured on or
 *  before it. Null before the first contour's capture day. Mirrors backend
 *  `services/sites.zones_at`; change both. */
export function contourOn(contours: SiteContour[], day: string): SiteContour | null {
  let valid: SiteContour | null = null;
  for (const contour of contourOrder(contours)) {
    if (utcDay(contour.captured_at) <= day) valid = contour;
  }
  return valid;
}

/** The contour that held before `contour`, in the zone rule's order, or null for the first. */
export function contourBefore(contours: SiteContour[], contour: SiteContour): SiteContour | null {
  const ordered = contourOrder(contours);
  const index = ordered.findIndex((c) => c.id === contour.id);
  return index > 0 ? ordered[index - 1] : null;
}

/** The contour the owner drew from an image, the latest when they drew several. */
export function contourFromImage(contours: SiteContour[], imageId: string): SiteContour | null {
  return contourOrder(contours).filter((c) => c.image_id === imageId).at(-1) ?? null;
}

/** The images newest first by capture time. */
export function sortImages(images: SiteImage[]): SiteImage[] {
  const key = (image: SiteImage) => image.captured_at ?? image.created_at;
  return [...images].sort((a, b) => key(b).localeCompare(key(a)));
}

/** The linked events newest first by event date. An undated event sits on the day it was
 *  linked, as the API's history places it. */
export function sortLinkedEvents(events: SiteLinkedEvent[]): SiteLinkedEvent[] {
  const key = (event: SiteLinkedEvent) => event.occurred_date ?? utcDay(event.linked_at);
  return [...events].sort((a, b) => key(b).localeCompare(key(a)));
}

/** The image the page opens on: the latest capture, whose zone is the one valid now. */
export function latestImage(images: SiteImage[]): SiteImage | null {
  return sortImages(images)[0] ?? null;
}

/** The zone effect a site's map paints: damage or destruction from the latest linked event;
 *  anything else stays neutral. */
export function zoneEmphasis(
  site: Pick<SiteListItem, "latest_link_effect">,
): "damage" | "destruction" | null {
  const effect = site.latest_link_effect?.effect;
  return effect === "damage" || effect === "destruction" ? effect : null;
}

/** An image editor as the site forms start it: a satellite source, one blank link. */
export function newSiteImageDraft(): SourceDraft {
  return { ...newSourceDraft(), level: "context", kind: "satellite" };
}

/** The labels of what the image still lacks before the API takes it, in the editor's order.
 *  Mirrors backend `schemas/site.SiteImageCreate`; change both. */
export function siteImageMissing(draft: SourceDraft, note: string, today: string): string[] {
  const missing: string[] = [];
  if (!draft.capturedAt) missing.push("Capture date");
  else if (draft.capturedAt.slice(0, 10) > today) missing.push("A capture date that is not in the future");
  if (draftUrls(draft).length === 0) missing.push("A link");
  if (note.length > SITE_IMAGE_NOTE_MAX_LEN) missing.push(`A note of at most ${SITE_IMAGE_NOTE_MAX_LEN} characters`);
  return missing;
}

/** The image fields of a site write, from the editor and the note. A blank note is absent. */
export function siteImagePayload(draft: SourceDraft, note: string): SiteImageCreate {
  const { title, captured_at, links, upload_id, media_id } = sourceCreatePayload(draft);
  return {
    title,
    captured_at: captured_at ?? "",
    links,
    upload_id,
    media_id,
    note: note.trim() || null,
  };
}

/** The site image a satellite source of an event becomes, its file shared: the offer the link
 *  dialog makes. Null when the source cannot be filed (no file, no capture time, or flagged
 *  graphic). Mirrors backend `services/sites._event_file`; change both. */
export function imageFromEventSource(source: {
  title: string;
  kind: string;
  captured_at: string | null;
  is_graphic: boolean;
  media: { id: string } | null;
  links: { url: string; archived: { url: string } | null }[];
}): SiteImageCreate | null {
  if (source.kind !== "satellite" || source.is_graphic || !source.media || !source.captured_at) {
    return null;
  }
  return {
    title: source.title,
    captured_at: source.captured_at,
    links: source.links.map((link) => ({ url: link.url, snapshot_url: link.archived?.url ?? null })),
    media_id: source.media.id,
    note: null,
  };
}

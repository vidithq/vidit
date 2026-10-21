import { apiFetch } from "./api";
import type { components } from "./api-types";
import { parseHttp } from "./format";

export type Site = components["schemas"]["SiteRead"];
export type SiteCreated = components["schemas"]["SiteCreatedRead"];
export type SiteListItem = components["schemas"]["SiteList"];
export type SiteObservation = components["schemas"]["SiteObservationRead"];
export type SiteObservationCreate = components["schemas"]["SiteObservationCreate"];
export type SiteLinkedEvent = components["schemas"]["SiteLinkedEventRead"];
export type SiteNearbyEvent = components["schemas"]["SiteNearbyEventRead"];
export type SiteHistoryEntry = components["schemas"]["SiteHistoryEntry"];
export type SiteOverlap = components["schemas"]["SiteOverlapRead"];
export type SiteSuggestion = components["schemas"]["SiteSuggestionRead"];
export type EventSiteLink = components["schemas"]["EventSiteLinkRead"];
export type Zone = components["schemas"]["ZonePolygon"];

export type SiteType = Site["site_type"];
export type ImageryProvider = Site["imagery_provider"];
export type ObservationEffect = Site["observation_effect"];
export type LinkEffect = EventSiteLink["effect"];
export type HistoryOrder = "fact" | "recorded";

/** Mirrors backend `models/event.TITLE_MAX_LENGTH`, the cap on a site name; change both. */
export const SITE_NAME_MAX_LEN = 255;
/** Mirrors backend `schemas/site.NOTE_MAX_LENGTH`; change both. */
export const SITE_NOTE_MAX_LEN = 2000;
/** Mirrors the `margin_m` default (2000 m) of backend `routers/sites` and `routers/events/sites`; change both. */
export const SITE_MARGIN_KM = 2;

export const SITE_TYPE_LABELS: Record<SiteType, string> = {
  airbase: "Airbase",
  military_base: "Military base",
  depot: "Depot",
  port: "Port",
  air_defence_position: "Air defence position",
  artillery_position: "Artillery position",
  radar: "Radar",
  fortification: "Fortification",
  other: "Other",
};

export const IMAGERY_PROVIDER_LABELS: Record<ImageryProvider, string> = {
  google_earth: "Google Earth",
  sentinel_2: "Sentinel-2",
  landsat: "Landsat",
  other: "Other",
};

export const OBSERVATION_EFFECT_LABELS: Record<ObservationEffect, string> = {
  observed_no_change: "Observed, no change",
  construction_extension: "Construction or extension",
  no_visible_activity: "No visible activity",
  reoccupation: "Reoccupation",
  other: "Other",
};

export const LINK_EFFECT_LABELS: Record<LinkEffect, string> = {
  damage: "Damage",
  destruction: "Destruction",
  other: "Other",
};

/** The options of a `<Select>` or `<SegmentedControl>` over one of the label maps, in the
 *  map's own order. */
export function labelOptions<T extends string>(
  labels: Record<T, string>,
): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

export function siteHref(id: string): string {
  return `/sites/${encodeURIComponent(id)}`;
}

export const NEW_SITE_HREF = "/sites/new";

export function sitesPath(bbox: string, asOf: string | null): string {
  const params = new URLSearchParams({ bbox });
  if (asOf) params.set("as_of", asOf);
  return `/sites?${params.toString()}`;
}

export function sitePath(id: string): string {
  return `/sites/${encodeURIComponent(id)}`;
}

export function siteHistoryPath(id: string, order: HistoryOrder): string {
  return `${sitePath(id)}/history?order=${order}`;
}

export function siteNearbyEventsPath(id: string): string {
  return `${sitePath(id)}/nearby-events`;
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

export function checkOverlaps(zone: Zone, signal?: AbortSignal): Promise<SiteOverlap[]> {
  return apiFetch<SiteOverlap[]>("/sites/overlaps", {
    method: "POST",
    body: JSON.stringify({ zone }),
    signal,
  });
}

export function addObservation(
  siteId: string,
  body: SiteObservationCreate,
): Promise<SiteObservation> {
  return apiFetch<SiteObservation>(`${sitePath(siteId)}/observations`, {
    method: "POST",
    body: JSON.stringify(body),
  });
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

/** "640 m" under a kilometre, "2.4 km" from there. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** "Corroborated by 3 analysts", or "Not corroborated" when only the owner linked events. */
export function corroborationLabel(site: Pick<Site, "is_corroborated" | "corroboration_count">): string {
  if (!site.is_corroborated) return "Not corroborated";
  return `Corroborated by ${site.corroboration_count} ${site.corroboration_count === 1 ? "analyst" : "analysts"}`;
}

/** Observations in the order the API serves them (capture date, then recording time): the
 *  last one is the current zone. The one before `id` in that order is its previous zone. */
export function previousObservation(
  observations: SiteObservation[],
  id: string,
): SiteObservation | null {
  const index = observations.findIndex((o) => o.id === id);
  return index > 0 ? observations[index - 1] : null;
}

/** The zone effect a site's map paints: damage or destruction from the latest linked event;
 *  anything else stays neutral. */
export function zoneEmphasis(site: Pick<Site, "latest_link_effect">): "damage" | "destruction" | null {
  const effect = site.latest_link_effect?.effect;
  return effect === "damage" || effect === "destruction" ? effect : null;
}

/** The observation fields of a form, as typed: the zone travels beside them. */
export interface ObservationDraft {
  capturedOn: string;
  provider: ImageryProvider | "";
  url: string;
  effect: ObservationEffect;
  note: string;
}

export const EMPTY_OBSERVATION: ObservationDraft = {
  capturedOn: "",
  provider: "",
  url: "",
  effect: "observed_no_change",
  note: "",
};

/** What the form still lacks before the API would take the observation, as the labels the
 *  incomplete notice lists. Mirrors backend `schemas/site.SiteObservationCreate`; change both. */
export function observationMissing(
  draft: ObservationDraft,
  zone: Zone | null,
  today: string,
): string[] {
  const missing: string[] = [];
  if (!zone) missing.push("A closed zone");
  if (!draft.provider) missing.push("Imagery provider");
  if (!draft.capturedOn) missing.push("Capture date");
  else if (draft.capturedOn > today) missing.push("A capture date that is not in the future");
  const url = draft.url.trim();
  if (draft.provider === "other" && !url) missing.push("Public URL of the image");
  else if (url && !parseHttp(url)) missing.push("An http or https image URL");
  if (draft.note.length > SITE_NOTE_MAX_LEN) missing.push(`A note under ${SITE_NOTE_MAX_LEN} characters`);
  return missing;
}

/** The API body of a complete draft. A blank URL or note is sent as absent. */
export function observationBody(draft: ObservationDraft, zone: Zone): SiteObservationCreate {
  return {
    zone,
    captured_on: draft.capturedOn,
    imagery_provider: draft.provider as ImageryProvider,
    imagery_url: draft.url.trim() || null,
    effect: draft.effect,
    note: draft.note.trim() || null,
  };
}

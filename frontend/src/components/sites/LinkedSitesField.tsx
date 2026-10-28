"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";

import { EventSection } from "@/components/event/EventLayout";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { META_LINE } from "@/components/ui/styles";
import { useApiResource } from "@/hooks/useApiResource";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { apiFetch } from "@/lib/api";
import { coordinatePair, type CoordinatePair } from "@/lib/coordinates";
import {
  SITE_KIND_LABELS,
  eventSiteLinksPath,
  saveSiteLinks,
  siteSuggestionsNearPath,
  type DraftSiteLink,
  type EventSiteLink,
  type SiteSuggestion,
} from "@/lib/sites";
import type { EventDetail } from "@/types";
import { EffectControl, LinkSearch, LinkSuggestionPills, siteCandidate } from "./LinkDialog";
import { NEAR_SITES_COPY, SITE_SEARCH_COPY } from "./useEventSites";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import type { ReadableError } from "@/lib/errors";

const POINT_DEBOUNCE_MS = 400;

/** The Linked sites an event form writes with the event. */
export interface SiteLinksDraft {
  links: DraftSiteLink[];
  setLinks: (links: DraftSiteLink[]) => void;
  /** The live links' read, on a published row. */
  loading: boolean;
  error: ReadableError | null;
  changed: boolean;
  /** A linked site still waits for its effect. */
  missingEffect: boolean;
  /** Writes the draft over the live links through the event's link endpoints. */
  save: (eventId: string) => Promise<void>;
}

const NO_LINKS: DraftSiteLink[] = [];

/** The form's Linked sites, seeded from the live links of a published row, else empty. */
export function useSiteLinksDraft(row: EventDetail | null): SiteLinksDraft {
  const live = useApiResource<EventSiteLink[]>(
    row?.status === "geolocated" ? eventSiteLinksPath(row.id) : null,
  );
  const [edited, setEdited] = useState<DraftSiteLink[] | null>(null);
  const before = live.data ?? NO_LINKS;
  const links = edited ?? before;
  const key = (list: DraftSiteLink[]) =>
    list
      .map((link) => `${link.site.id} ${link.effect}`)
      .sort()
      .join();
  return {
    links,
    setLinks: setEdited,
    loading: live.loading,
    error: live.error,
    changed: key(links) !== key(before),
    missingEffect: links.some((link) => !link.effect),
    save: (eventId) => saveSiteLinks(eventId, before, links),
  };
}

/**
 * The Linked sites block of an event form, last in the side column like the event page's: each
 * linked site as an accent chip a click removes, over the effect the event shows there, then the
 * sites near the event's point as chips, the first few and one **Show more**, then the name
 * search. Nothing is written before the form's write.
 */
export function LinkedSitesField({
  draft,
  lat,
  lng,
  invalid,
}: {
  draft: SiteLinksDraft;
  /** The form's coordinates, as typed. */
  lat: string;
  lng: string;
  invalid: boolean;
}) {
  const { links, setLinks } = draft;
  const [point, setPoint] = useState<CoordinatePair | null>(null);
  const typed = coordinatePair(lat, lng);
  useDebouncedEffect(() => setPoint(typed), [typed?.lat, typed?.lng], POINT_DEBOUNCE_MS);
  const near = useApiResource<SiteSuggestion[]>(point ? siteSuggestionsNearPath(point, "") : null);

  const picked = new Set(links.map((link) => link.site.id));
  const unpicked = (rows: SiteSuggestion[]) => rows.filter((row) => !picked.has(row.id));
  // A candidate carries the label only; the link keeps the site it was found as.
  const searched = useRef(new Map<string, SiteSuggestion>());
  const add = (id: string) => {
    const site = near.data?.find((row) => row.id === id) ?? searched.current.get(id);
    if (site && !picked.has(id)) setLinks([...links, { site, effect: "" }]);
  };

  return (
    <EventSection
      name="sites"
      slot={{
        invalid,
        content: (
          <Card dense>
            {draft.error && <ErrorNotice error={draft.error} />}
            {draft.loading ? (
              <p className={META_LINE}>Loading…</p>
            ) : (
              links.length > 0 && (
                <ul className="space-y-3">
                  {links.map((link) => (
                    <li key={link.site.id} className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill
                          tone="accent"
                          title={`Remove ${link.site.name}`}
                          onClick={() => setLinks(links.filter((l) => l.site.id !== link.site.id))}
                        >
                          {link.site.name}
                          <X size={12} aria-hidden />
                        </Pill>
                        <span className={META_LINE}>{SITE_KIND_LABELS[link.site.kind]}</span>
                      </div>
                      <EffectControl
                        aria-label={`Effect at ${link.site.name}`}
                        fullWidth={false}
                        value={link.effect}
                        onChange={(effect) =>
                          setLinks(links.map((l) => (l.site.id === link.site.id ? { ...l, effect } : l)))
                        }
                      />
                    </li>
                  ))}
                </ul>
              )
            )}
            {point && (
              <LinkSuggestionPills
                suggestions={{
                  ...NEAR_SITES_COPY,
                  rows: near.data ? unpicked(near.data).map(siteCandidate) : near.error ? [] : null,
                }}
                onPick={(row) => add(row.id)}
              />
            )}
            <LinkSearch
              label={SITE_SEARCH_COPY.label}
              placeholder={SITE_SEARCH_COPY.placeholder}
              search={(q, signal) =>
                apiFetch<SiteSuggestion[]>(siteSuggestionsNearPath(point, q), { signal }).then(
                  (rows) => {
                    for (const row of rows) searched.current.set(row.id, row);
                    return unpicked(rows).map(siteCandidate);
                  },
                )
              }
              onPick={(row) => add(row.id)}
            />
          </Card>
        ),
      }}
    />
  );
}

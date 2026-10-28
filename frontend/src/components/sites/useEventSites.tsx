"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";

import { EventSection } from "@/components/event/EventLayout";
import { Button } from "@/components/ui/Button";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { TEXT_LINK } from "@/components/ui/styles";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import {
  SITE_MARGIN_KM,
  eventSiteLinksPath,
  linkEventToSite,
  siteHref,
  siteSuggestionsPath,
  type EventSiteLink,
  type SiteSuggestion,
} from "@/lib/sites";
import type { EventDetail } from "@/types";
import { LinkDialog, siteCandidate } from "./LinkDialog";
import { LinkEffectPill } from "./SiteBadges";
import { SatelliteSourcesOffer, fileOffered, useSatelliteOffer } from "./SatelliteSourcesOffer";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/** The site picker's suggestions line: the sites near the event. */
export const NEAR_SITES_COPY = { label: `Sites within ${SITE_MARGIN_KM} km of the event` };

/** The words of a site search, in the dialog and in the forms. */
export const SITE_SEARCH_COPY = {
  label: "Search a site by name",
  placeholder: "Search a site by name",
};

/**
 * The sites of the event page, as two nodes over one read of the event's links:
 *
 * - `block`, the Linked sites block last in the side column: each site the event is linked to,
 *   with the effect the event shows there. Null while the event has no link.
 * - `linkAction`, **Link to a site** for the actions row: the owner of a published event links
 *   it to a site from the dialog it opens. Null for every other reader.
 *
 * `event` is null while the row loads and on a surface without sites: both nodes are null then.
 */
export function useEventSites(event: EventDetail | null): {
  block: ReactNode;
  linkAction: ReactNode;
} {
  const { user } = useAuth();
  const links = useApiResource<EventSiteLink[]>(event ? eventSiteLinksPath(event.id) : null);
  const [linking, setLinking] = useState(false);
  const offer = useSatelliteOffer();
  const suggestions = useApiResource<SiteSuggestion[]>(
    event && linking ? siteSuggestionsPath(event.id, "") : null,
  );

  if (!event) return { block: null, linkAction: null };

  // Mirrors backend `event_filters.site_linkable_events`: a published event only; change both.
  const canLink = user?.id === event.owner.id && event.status === "geolocated";
  const rows = links.data ?? [];

  const block = (rows.length > 0 || links.error) && (
    <EventSection
      name="sites"
      slot={{
        content: (
          <DetailCard>
            {links.error && <ErrorNotice error={links.error} className="m-3" />}
            {rows.map((row) => (
              <DetailRow
                key={row.site.id}
                align="center"
                wrapLabel
                label={
                  <Link href={siteHref(row.site.id)} className={TEXT_LINK}>
                    {row.site.name}
                  </Link>
                }
              >
                <span className="ml-auto flex shrink-0 justify-end">
                  <LinkEffectPill effect={row.effect} />
                </span>
              </DetailRow>
            ))}
          </DetailCard>
        ),
      }}
    />
  );

  const linkAction = canLink && (
    <>
      <Button
        icon
        variant="ghost"
        aria-label="Link to a site"
        aria-haspopup="dialog"
        onClick={() => setLinking(true)}
      >
        <Link2 size={14} />
      </Button>
      {linking && (
        <LinkDialog
          title="Link to a site"
          intro="Pick the site this event happened at, then say what the event shows there. The link holds even when the event lies outside the site's zone."
          pickLabel="Site"
          suggestions={{
            ...NEAR_SITES_COPY,
            rows: suggestions.data?.map(siteCandidate) ?? (suggestions.error ? [] : null),
          }}
          searchLabel={SITE_SEARCH_COPY.label}
          searchPlaceholder={SITE_SEARCH_COPY.placeholder}
          search={(q, signal) =>
            apiFetch<SiteSuggestion[]>(siteSuggestionsPath(event.id, q), { signal }).then((found) =>
              found.map(siteCandidate),
            )
          }
          extra={() => (
            <SatelliteSourcesOffer
              sources={event.sources}
              picked={offer.forEvent(event.id)}
              onToggle={(id) => offer.toggle(event.id, id)}
            />
          )}
          onLink={async (site, effect) => {
            await linkEventToSite(event.id, site.id, effect);
            links.refetch();
            await fileOffered(site.id, event.sources, offer.forEvent(event.id));
          }}
          onClose={() => setLinking(false)}
        />
      )}
    </>
  );

  return { block, linkAction };
}

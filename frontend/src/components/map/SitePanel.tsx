"use client";

import type { ApiResource } from "@/hooks/useApiResource";
import { latestSource, siteHref, type Site, type SiteListItem } from "@/lib/sites";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailRow } from "@/components/ui/DetailRow";
import { LinkEffectPill, SiteKindPill } from "@/components/sites/SiteBadges";
import { LastSourceValue, LatestEffectValue, lastSourceText } from "@/components/sites/SiteFacts";
import { MapSidePanel, type MapPanelContent } from "./MapSidePanel";

/** The site panel's filling, the event panel's blocks: the owner under the name, the latest
 *  source by the site page's order, the zone's centre, then the kind, the last source, the
 *  latest effect and the counts. */
function sitePanelContent(site: Site): MapPanelContent {
  const latest = latestSource(site.sources);
  return {
    title: site.name,
    href: siteHref(site.id),
    byline: <AuthorByline author={site.owner} size="xs" avatar />,
    sources: latest ? [latest] : [],
    coords: site.centroid,
    concepts: { location: "site_location", details: "site_details", coordinates: "site_coordinates" },
    details: (
      <>
        <DetailRow compact label="Kind" concept="site_kind" align="center">
          <SiteKindPill kind={site.kind} />
        </DetailRow>
        <DetailRow compact label="Last source" concept="site_last_source">
          <LastSourceValue site={site} />
        </DetailRow>
        {site.latest_link_effect && (
          <DetailRow compact label="Latest effect" concept="link_effect" align="center">
            <LatestEffectValue effect={site.latest_link_effect} />
          </DetailRow>
        )}
        <DetailRow compact label="Sources" value={site.sources.length} />
        <DetailRow compact label="Linked events" value={site.linked_events.length} />
      </>
    ),
  };
}

/** The map's side panel on a site. */
export function SitePanel({
  resource,
  onClose,
}: {
  resource: ApiResource<Site>;
  onClose: () => void;
}) {
  return (
    <MapSidePanel
      resource={resource}
      onClose={onClose}
      errorFallback="Couldn't load this site."
      content={sitePanelContent}
    />
  );
}

/** The hover preview of a site on the map, from the list row it already holds: the name, the kind,
 *  the latest effect and the last capture. */
export function SitePreview({
  site,
}: {
  site: Pick<SiteListItem, "name" | "kind" | "latest_link_effect" | "last_source">;
}) {
  return (
    <>
      <p className="text-xs font-medium text-neutral-100 line-clamp-2">{site.name}</p>
      <div className="flex flex-wrap gap-1.5">
        <SiteKindPill kind={site.kind} />
        {site.latest_link_effect && <LinkEffectPill effect={site.latest_link_effect.effect} />}
      </div>
      <p className="text-[11px] text-neutral-500">Last source: {lastSourceText(site)}</p>
    </>
  );
}

"use client";

import type { ApiResource } from "@/hooks/useApiResource";
import {
  LINK_EFFECT_LABELS,
  latestSource,
  siteHref,
  type Site,
  type SiteListItem,
} from "@/lib/sites";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailRow } from "@/components/ui/DetailRow";
import { Item } from "@/components/ui/Item";
import { SiteKindPill } from "@/components/sites/SiteBadges";
import { LastSourceValue, LatestEffectValue } from "@/components/sites/SiteFacts";
import { siteItem } from "@/lib/items";
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
      content={sitePanelContent}
    />
  );
}

/** The hover preview of a site on the map, from the list row it already holds: the compact
 *  `<Item>`, with the latest effect after its last capture. */
export function SitePreview({ site }: { site: SiteListItem }) {
  return (
    <Item
      variant="compact"
      {...siteItem(site)}
      href={undefined}
      extra={[site.latest_link_effect && LINK_EFFECT_LABELS[site.latest_link_effect.effect]]}
    />
  );
}

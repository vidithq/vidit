"use client";

import Link from "next/link";

import type { ApiResource } from "@/hooks/useApiResource";
import { siteHref, type Site, type SiteListItem } from "@/lib/sites";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { buttonClasses } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";
import { LinkEffectPill, SiteKindPill } from "@/components/sites/SiteBadges";
import { LastSourceValue, LatestEffectValue, lastSourceText } from "@/components/sites/SiteFacts";
import { MapSidePanel } from "./MapSidePanel";

/** The map's side panel on a site: what it is, when it was last captured, the latest effect a
 *  linked event shows, and the way to its page. */
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
      heading={(site) => ({
        title: site.name,
        href: siteHref(site.id),
        meta: (
          <div className="flex flex-wrap gap-1.5">
            <SiteKindPill kind={site.kind} />
          </div>
        ),
      })}
    >
      {(site) => (
        <>
          <div className="space-y-2 text-sm">
            <DetailRow compact label="Last source" concept="site_last_source">
              <LastSourceValue site={site} />
            </DetailRow>
            {site.latest_link_effect && (
              <DetailRow compact label="Latest effect" align="center">
                <LatestEffectValue effect={site.latest_link_effect} />
              </DetailRow>
            )}
            <DetailRow compact label="Sources" value={site.sources.length} />
            <DetailRow compact label="Linked events" value={site.linked_events.length} />
            <DetailRow compact label="Owner">
              <AuthorByline author={site.owner} size="xs" avatar />
            </DetailRow>
          </div>
          <Link href={siteHref(site.id)} className={buttonClasses("secondary", { fullWidth: true })}>
            Open the site page
          </Link>
        </>
      )}
    </MapSidePanel>
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

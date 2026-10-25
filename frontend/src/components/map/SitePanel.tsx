"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { ApiResource } from "@/hooks/useApiResource";
import { siteHref, type Site } from "@/lib/sites";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { buttonClasses } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";
import { TEXT_LINK } from "@/components/ui/styles";
import { CorroborationPill, SiteKindPill } from "@/components/sites/SiteBadges";
import { LastImageValue, LatestEffectValue } from "@/components/sites/SiteFacts";
import { MapOverlayPanel } from "./DetailSidePanel";

/** The compact panel a site opens on the map: what it is, when it was last imaged, the latest
 *  effect a linked event shows, and the way to its page. */
export function SitePanel({
  resource,
  onClose,
}: {
  resource: ApiResource<Site>;
  onClose: () => void;
}) {
  return (
    <MapOverlayPanel resource={resource} onClose={onClose} errorFallback="Couldn't load this site.">
      {(site) => (
        <>
          <div className="space-y-2">
            <h2 className="text-lg font-medium pr-6">
              <Link href={siteHref(site.id)} className={`text-neutral-100 ${TEXT_LINK}`}>
                {site.name}
                <ArrowRight size={14} className="ml-1 inline align-[-2px]" />
              </Link>
            </h2>
            <div className="flex flex-wrap gap-1.5">
              <SiteKindPill kind={site.kind} />
              <CorroborationPill site={site} />
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <DetailRow compact label="Last image" concept="site_last_image">
              <LastImageValue site={site} />
            </DetailRow>
            {site.latest_link_effect && (
              <DetailRow compact label="Latest effect" align="center">
                <LatestEffectValue effect={site.latest_link_effect} />
              </DetailRow>
            )}
            <DetailRow compact label="Images" value={site.images.length} />
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
    </MapOverlayPanel>
  );
}

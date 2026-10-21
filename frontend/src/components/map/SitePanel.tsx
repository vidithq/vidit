"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { ApiResource } from "@/hooks/useApiResource";
import { formatDate } from "@/lib/format";
import {
  IMAGERY_PROVIDER_LABELS,
  siteHref,
  type Site,
} from "@/lib/sites";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { buttonClasses } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";
import { TEXT_LINK } from "@/components/ui/styles";
import {
  CorroborationPill,
  LinkEffectPill,
  ObservationEffectPill,
  SiteTypePill,
} from "@/components/sites/SiteBadges";
import { MapOverlayPanel } from "./DetailSidePanel";

/** The compact panel a site opens on the map: what it is, when it was last observed, and the
 *  way to its page. */
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
              <SiteTypePill type={site.site_type} />
              <CorroborationPill site={site} />
            </div>
          </div>
          <div className="space-y-2 text-xs">
            <DetailRow
              compact
              label="Last observed"
              concept="site_last_observed"
              value={`${formatDate(site.observed_on)}, ${IMAGERY_PROVIDER_LABELS[site.imagery_provider]}`}
            />
            <DetailRow compact label="Imagery shows" align="center">
              <ObservationEffectPill effect={site.observation_effect} />
            </DetailRow>
            {site.latest_link_effect && (
              <DetailRow compact label="Latest linked event" align="center">
                <LinkEffectPill effect={site.latest_link_effect.effect} />
              </DetailRow>
            )}
            <DetailRow compact label="Linked events" value={site.linked_events.length} />
            <DetailRow compact label="Owner">
              <AuthorByline author={site.owner} size="xs" avatar />
            </DetailRow>
          </div>
          <Link href={siteHref(site.id)} className={buttonClasses("secondary", { fullWidth: true })}>
            Open site page
          </Link>
        </>
      )}
    </MapOverlayPanel>
  );
}

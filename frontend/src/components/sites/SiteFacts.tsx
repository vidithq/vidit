import Link from "next/link";

import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { TEXT_LINK } from "@/components/ui/styles";
import { formatDate, formatInstantDate } from "@/lib/format";
import { eventHref } from "@/lib/routes";
import type { Site } from "@/lib/sites";
import { LinkEffectPill, SiteKindPill } from "./SiteBadges";

/** "7 Sep 2026, Copernicus Browser": when the site was last captured and by which provider. */
export function lastSourceText(site: Pick<Site, "last_source">): string {
  const source = site.last_source;
  if (!source) return "No source";
  const date = formatInstantDate(source.captured_at);
  return source.provider ? `${date}, ${source.provider.name}` : date;
}

export function LastSourceValue({ site }: { site: Pick<Site, "last_source"> }) {
  return <span className="text-right text-neutral-200">{lastSourceText(site)}</span>;
}

/** The latest linked event's effect, then its date, which opens the event. */
export function LatestEffectValue({ effect }: { effect: NonNullable<Site["latest_link_effect"]> }) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <LinkEffectPill effect={effect.effect} />
      <Link href={eventHref(effect.event_id)} className={`text-sm ${TEXT_LINK}`}>
        {effect.occurred_date ? formatDate(effect.occurred_date) : "Undated event"}
      </Link>
    </span>
  );
}

/** The site page's Details card, the event page's `DetailCard`. `hidden_at` reaches an admin
 *  alone, so the Withheld row shows to no one else. */
export function SiteDetails({ site }: { site: Site }) {
  return (
    <DetailCard>
      <DetailRow label="Owner">
        <AuthorByline author={site.owner} avatar className="text-sm" />
      </DetailRow>
      <DetailRow label="Kind" concept="site_kind" align="center">
        <SiteKindPill kind={site.kind} />
      </DetailRow>
      <DetailRow label="Last source" concept="site_last_source" value={lastSourceText(site)} />
      {site.latest_link_effect && (
        <DetailRow label="Latest effect" concept="link_effect" align="center">
          <LatestEffectValue effect={site.latest_link_effect} />
        </DetailRow>
      )}
      <DetailRow label="Created" value={formatInstantDate(site.created_at)} />
      {site.hidden_at && <DetailRow label="Withheld" value={formatInstantDate(site.hidden_at)} />}
    </DetailCard>
  );
}

import Link from "next/link";

import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { TEXT_LINK } from "@/components/ui/styles";
import { formatDate, formatInstantDate } from "@/lib/format";
import { eventHref } from "@/lib/routes";
import { corroborationLabel, type Site } from "@/lib/sites";
import { LinkEffectPill, SiteKindPill } from "./SiteBadges";

/** "7 Sep 2026, Copernicus Browser": when the site was last imaged and by which provider. */
export function lastImageText(site: Pick<Site, "last_image">): string {
  const image = site.last_image;
  if (!image) return "No image";
  const date = formatInstantDate(image.captured_at);
  return image.provider ? `${date}, ${image.provider.name}` : date;
}

export function LastImageValue({ site }: { site: Pick<Site, "last_image"> }) {
  return <span className="text-right text-neutral-200">{lastImageText(site)}</span>;
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
      <DetailRow label="Last image" concept="site_last_image" value={lastImageText(site)} />
      {site.latest_link_effect && (
        <DetailRow label="Latest effect" concept="link_effect" align="center">
          <LatestEffectValue effect={site.latest_link_effect} />
        </DetailRow>
      )}
      <DetailRow label="Corroboration" concept="site_corroboration" value={corroborationLabel(site)} />
      <DetailRow label="Created" value={formatInstantDate(site.created_at)} />
      {site.hidden_at && <DetailRow label="Withheld" value={formatInstantDate(site.hidden_at)} />}
    </DetailCard>
  );
}

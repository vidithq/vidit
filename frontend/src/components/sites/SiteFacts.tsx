import Link from "next/link";

import { TEXT_LINK } from "@/components/ui/styles";
import { formatDate, formatInstantDate } from "@/lib/format";
import { eventHref } from "@/lib/routes";
import type { Site } from "@/lib/sites";
import { LinkEffectPill } from "./SiteBadges";

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

"use client";

import type { ReactNode } from "react";
import { MapPinned } from "lucide-react";

import type { SourceBlockExtras } from "@/components/sources/SourceBlock";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { formatDate, formatInstantDate } from "@/lib/format";
import { formatAreaKm2, zoneAreaKm2, zoneVertices } from "@/lib/siteZone";
import type { SiteContour, SiteSource } from "@/lib/sites";

/** A site source's name, by its capture day: *Source of 7 Sept 2026*. */
export function siteSourceName(source: Pick<SiteSource, "captured_at" | "created_at">): string {
  return `Source of ${formatInstantDate(source.captured_at ?? source.created_at)}`;
}

/** A site source's name inside a sentence: *the source of 7 Sept 2026*. */
export function siteSourceMention(source: Pick<SiteSource, "captured_at" | "created_at">): string {
  return `the ${siteSourceName(source).replace("Source", "source")}`;
}

/** The name of a site source's Remove control, which says why it is off while the source
 *  carries a contour. */
export function removeSourceLabel(source: Pick<SiteSource, "captured_at" | "created_at">, carriesContour: boolean): string {
  const name = siteSourceMention(source);
  return carriesContour
    ? `${name.charAt(0).toUpperCase()}${name.slice(1)} carries a contour: redraw it on another source before you remove it`
    : `Remove ${name}`;
}

/** A provider's credit line with its `[year]` filled in from the capture date. */
function creditFor(credit: string, capturedAt: string | null): string {
  return capturedAt ? credit.replace("[year]", capturedAt.slice(0, 4)) : credit;
}

/** A site source card's map control: an icon button that puts the source's zone on the map, or
 *  an accent *On the map* pill on the source on show. */
export function ShowOnMap({
  name,
  shown,
  onShow,
}: {
  name: string;
  shown: boolean;
  onShow: () => void;
}) {
  return shown ? (
    // As tall as the icon button it replaces, so every card's rows start level.
    <span className="flex h-8 items-center">
      <Pill tone="accent" icon={<MapPinned size={11} />}>
        On the map
      </Pill>
    </span>
  ) : (
    <Button
      icon
      variant="ghost"
      onClick={onShow}
      aria-label={`Show the zone of the ${name[0].toLowerCase()}${name.slice(1)} on the map`}
    >
      <MapPinned size={14} />
    </Button>
  );
}

/**
 * What one site source adds to the event page's source block: its name by capture day, the
 * control that shows that day's zone on the site map (an accent *On the map* pill and border on
 * the source on show), then `controls` (its filer's Remove), and the rows for the provider, the
 * note, who filed it and when, and the contour drawn on it. It drops the Level and Kind rows,
 * which read the same on every site source.
 */
export function siteSourceExtras({
  source,
  contour,
  shown,
  onShow,
  controls,
}: {
  source: SiteSource;
  /** The contour drawn on this source, if any. */
  contour: Pick<SiteContour, "zone"> | null;
  /** Its day's zone is the one on the map. */
  shown: boolean;
  onShow: () => void;
  controls?: ReactNode;
}): SourceBlockExtras {
  const name = siteSourceName(source);
  return {
    name,
    levelAndKind: false,
    className: cn(shown && "border-orange-500/50"),
    actions: (
      <>
        <ShowOnMap name={name} shown={shown} onShow={onShow} />
        {controls}
      </>
    ),
    children: (
      <>
        <DetailRow label="Provider" concept="site_source">
          <span className="text-right text-sm text-neutral-200">
            {source.provider?.name ?? "Not a listed provider"}
            {source.provider?.credit && (
              <span className="block text-xs text-neutral-500">
                Credit: {creditFor(source.provider.credit, source.captured_at)}
              </span>
            )}
          </span>
        </DetailRow>
        {source.note && <DetailRow label="Note" value={source.note} />}
        <DetailRow label="Filed" align="center">
          <span className="flex flex-wrap items-center justify-end gap-x-1.5 text-sm text-neutral-400">
            {source.author ? (
              <AuthorByline author={source.author} prefix={false} avatar size="xs" />
            ) : (
              <span>A deleted account</span>
            )}
            <span>on {formatDate(source.created_at)}</span>
          </span>
        </DetailRow>
        {contour && (
          <DetailRow
            label="Contour"
            concept="site_zone"
            value={`Drawn on this source, ${formatAreaKm2(zoneAreaKm2(zoneVertices(contour.zone)))}`}
          />
        )}
      </>
    ),
  };
}

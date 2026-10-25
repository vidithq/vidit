"use client";

import { MapPinned } from "lucide-react";

import { SourceBlock } from "@/components/sources/SourceBlock";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { formatDate, formatInstantDate } from "@/lib/format";
import { zoneAreaKm2, zoneVertices } from "@/lib/siteZone";
import type { SiteContour, SiteImage } from "@/lib/sites";

/** An image's name, by its capture day: *Image of 7 Sep 2026*. */
export function imageName(image: Pick<SiteImage, "captured_at" | "created_at">): string {
  return `Image of ${formatInstantDate(image.captured_at ?? image.created_at)}`;
}

/** A provider's credit line with its `[year]` filled in from the capture date. */
function creditFor(credit: string, capturedAt: string | null): string {
  return capturedAt ? credit.replace("[year]", capturedAt.slice(0, 4)) : credit;
}

/**
 * One image of a site's imagery history: the event page's source block, as a site image (the
 * file beside its rows once the card is wide), headed by its capture day and the control that
 * shows that day's zone on the site map. Its rows add the provider, the note, who filed it and
 * when, and the contour the owner drew from it.
 */
export function SiteImageCard({
  image,
  contour,
  alt,
  shown,
  onShow,
}: {
  image: SiteImage;
  /** The contour drawn from this image, if any. */
  contour: SiteContour | null;
  alt: string;
  /** Its day's zone is the one on the map. */
  shown: boolean;
  onShow: () => void;
}) {
  const name = imageName(image);
  return (
    <SourceBlock
      source={image}
      index={0}
      alt={alt}
      wide
      variant="site-image"
      name={name}
      className={cn(shown && "border-orange-500/50")}
      header={
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h3 className="text-sm font-medium text-neutral-100">{name}</h3>
          {shown ? (
            <Pill tone="accent" icon={<MapPinned size={11} />}>
              On the map
            </Pill>
          ) : (
            <Button variant="ghost" onClick={onShow} aria-label={`Show the zone of the ${name.replace("Image", "image")} on the map`}>
              <MapPinned size={14} />
              Show on the map
            </Button>
          )}
        </div>
      }
    >
      <DetailRow label="Provider" concept="site_image">
        <span className="text-right text-sm text-neutral-200">
          {image.provider?.name ?? "Not a listed provider"}
          {image.provider?.credit && (
            <span className="block text-xs text-neutral-500">
              Credit: {creditFor(image.provider.credit, image.captured_at)}
            </span>
          )}
        </span>
      </DetailRow>
      {image.note && <DetailRow label="Note" value={image.note} />}
      <DetailRow label="Filed" align="center">
        <span className="flex flex-wrap items-center justify-end gap-x-1.5 text-sm text-neutral-400">
          {image.author ? (
            <AuthorByline author={image.author} prefix={false} avatar size="xs" />
          ) : (
            <span>A deleted account</span>
          )}
          <span>on {formatDate(image.created_at)}</span>
        </span>
      </DetailRow>
      {contour && (
        <DetailRow
          label="Contour"
          concept="site_zone"
          value={`Drawn from this image, ${zoneAreaKm2(zoneVertices(contour.zone)).toFixed(2)} km²`}
        />
      )}
    </SourceBlock>
  );
}

"use client";

import { MapPinned } from "lucide-react";

import type { SourceBlockExtras } from "@/components/sources/SourceBlock";
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

/** The names the contour form's image picker shows, by image id: the capture day and the
 *  provider, plus who filed it when two images would otherwise read the same. */
export function imageChoiceLabels(images: SiteImage[]): Map<string, string> {
  const base = (image: SiteImage) =>
    image.provider ? `${imageName(image)}, ${image.provider.name}` : imageName(image);
  const counts = new Map<string, number>();
  for (const image of images) counts.set(base(image), (counts.get(base(image)) ?? 0) + 1);
  return new Map(
    images.map((image) => {
      const label = base(image);
      const repeated = (counts.get(label) ?? 0) > 1 && image.author;
      return [image.id, repeated ? `${label}, filed by ${image.author!.username}` : label];
    }),
  );
}

/** A provider's credit line with its `[year]` filled in from the capture date. */
function creditFor(credit: string, capturedAt: string | null): string {
  return capturedAt ? credit.replace("[year]", capturedAt.slice(0, 4)) : credit;
}

/**
 * What one image adds to the event page's source block in a site's imagery history: its name
 * by capture day, the control that shows that day's zone on the site map (an accent *On the map*
 * pill and border on the image on show), and the rows for the provider, the note, who filed it
 * and when, and the contour the owner drew from it.
 */
export function siteImageExtras({
  image,
  contour,
  shown,
  onShow,
}: {
  image: SiteImage;
  /** The contour drawn from this image, if any. */
  contour: SiteContour | null;
  /** Its day's zone is the one on the map. */
  shown: boolean;
  onShow: () => void;
}): SourceBlockExtras {
  const name = imageName(image);
  return {
    name,
    className: cn(shown && "border-orange-500/50"),
    actions: shown ? (
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
        aria-label={`Show the zone of the ${name.replace("Image", "image")} on the map`}
      >
        <MapPinned size={14} />
      </Button>
    ),
    children: (
      <>
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
      </>
    ),
  };
}

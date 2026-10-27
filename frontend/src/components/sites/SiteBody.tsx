"use client";

import { useRef, useState, type ReactNode } from "react";

import { EventSection } from "@/components/event/EventLayout";
import { SourceBlocks } from "@/components/sources/SourceBlock";
import { PageColumns } from "@/components/ui/PageShell";
import { contourFromImage, latestImage, sortImages, type Site, type SiteImage } from "@/lib/sites";
import { siteImageExtras } from "./SiteImageBlock";
import { SiteDetails } from "./SiteFacts";
import { SiteLocation } from "./SiteLocation";

// Below `lg` the map sits under the lists, so a pick scrolls it into view.
const NARROW = "(max-width: 1023.98px)";

/**
 * The body of a site's page and of one of its versions, on the event page's `PageColumns`: the
 * main column holds the Sources section (the images as the event page's source blocks, newest
 * capture first, each with `imageControls`), then `linked`. The side column holds the event
 * page's Location block, which shows the zone of the picked image's date, then its Details
 * block. Below `lg` the side column follows the main column, the event page's order.
 */
export function SiteBody({
  site,
  imageControls,
  linked,
}: {
  site: Site;
  imageControls?: (image: SiteImage) => ReactNode;
  linked?: ReactNode;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const picked = site.images.find((i) => i.id === pickedId) ?? latestImage(site.images);
  const show = (id: string) => {
    setPickedId(id);
    if (window.matchMedia(NARROW).matches) zoneRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  return (
    <PageColumns
      main={
        <>
          <SourceBlocks
            sources={sortImages(site.images)}
            alt={site.name}
            extras={(image) =>
              siteImageExtras({
                image,
                contour: contourFromImage(site.contours, image.id),
                shown: image.id === picked?.id,
                onShow: () => show(image.id),
                controls: imageControls?.(image),
              })
            }
          />
          {linked}
        </>
      }
      side={
        <>
          <EventSection
            name="location"
            concept="site_location"
            besideScroller
            slot={{ content: <SiteLocation ref={zoneRef} site={site} image={picked} /> }}
          />
          <EventSection
            name="details"
            concept="site_details"
            slot={{ content: <SiteDetails site={site} /> }}
          />
        </>
      }
    />
  );
}

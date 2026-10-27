"use client";

import { useRef, useState, type ReactNode } from "react";

import { EventSection } from "@/components/event/EventLayout";
import { SourceBlocks } from "@/components/sources/SourceBlock";
import { PageColumns } from "@/components/ui/PageShell";
import { contourOfSource, latestSource, sortSources, type Site, type SiteSource } from "@/lib/sites";
import { siteSourceExtras } from "./SiteSourceBlock";
import { SiteDetails } from "./SiteFacts";
import { SiteLocation } from "./SiteLocation";

// Below `lg` the map sits under the lists, so a pick scrolls it into view.
const NARROW = "(max-width: 1023.98px)";

/**
 * The body of a site's page and of one of its versions, on the event page's `PageColumns`: the
 * main column holds the Sources section (the sources as the event page's source blocks, newest
 * capture first, each with `sourceControls`), then `linked`. The side column holds the event
 * page's Location block, which shows the zone of the picked source's date, then its Details
 * block. Below `lg` the side column follows the main column, the event page's order.
 */
export function SiteBody({
  site,
  sourceControls,
  linked,
}: {
  site: Site;
  sourceControls?: (source: SiteSource) => ReactNode;
  linked?: ReactNode;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const picked = site.sources.find((i) => i.id === pickedId) ?? latestSource(site.sources);
  const show = (id: string) => {
    setPickedId(id);
    if (window.matchMedia(NARROW).matches) zoneRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  return (
    <PageColumns
      main={
        <>
          <SourceBlocks
            sources={sortSources(site.sources)}
            alt={site.name}
            extras={(source) =>
              siteSourceExtras({
                source,
                contour: contourOfSource(site.contours, source.id),
                shown: source.id === picked?.id,
                onShow: () => show(source.id),
                controls: sourceControls?.(source),
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
            slot={{ content: <SiteLocation ref={zoneRef} site={site} source={picked} /> }}
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

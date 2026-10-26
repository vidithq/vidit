"use client";

import { useRef, useState } from "react";
import { useParams } from "next/navigation";

import { PageColumns, PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { EventSection } from "@/components/event/EventLayout";
import { SiteDetails } from "@/components/sites/SiteFacts";
import { SiteChanges } from "@/components/sites/SiteChanges";
import { siteImageExtras } from "@/components/sites/SiteImageBlock";
import { SourceBlocks } from "@/components/sources/SourceBlock";
import { LinkedEvents } from "@/components/sites/SiteEventLists";
import { SiteLocation } from "@/components/sites/SiteLocation";
import { useSiteActions } from "@/components/sites/useSiteActions";
import { useApiResource } from "@/hooks/useApiResource";
import { contourFromImage, latestImage, sitePath, sortImages, type Site } from "@/lib/sites";

// Below `lg` the map sits under the lists, so a pick scrolls it into view.
const NARROW = "(max-width: 1023.98px)";

/**
 * A site's page, on the event page's frame: the title section and the pinned actions on
 * `PageShell`, then a `PageColumns` body. The main column holds the Sources section (the site's
 * images as the event page's source blocks), then the Linked events section, both newest first
 * by date on the ground, then the changes on record. The side column holds the event page's
 * Location block, which shows the zone of the picked image's date, then its Details block. Below
 * `lg` the side column follows the main column, the event page's order.
 */
export default function SitePage() {
  const params = useParams();
  const siteId = typeof params.id === "string" ? params.id : "";
  const { data: site, error, refetch } = useApiResource<Site>(siteId ? sitePath(siteId) : null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  // Bumped by every write, so the changes on record read the history again.
  const [revision, setRevision] = useState(0);
  const refreshed = () => {
    refetch();
    setRevision((n) => n + 1);
  };
  const actions = useSiteActions({ site, onChanged: refreshed });

  if (error) return <PageError message={error} backHref="/map" />;
  if (!site) return <PageLoading />;

  const picked = site.images.find((i) => i.id === pickedId) ?? latestImage(site.images);
  const show = (id: string) => {
    setPickedId(id);
    if (window.matchMedia(NARROW).matches) zoneRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <PageShell
      back
      backFallback="/map"
      title={site.name}
      stickyActions={actions.pinned}
      headerSide={null}
    >
      {actions.panels}
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
                })
              }
            />
            <LinkedEvents events={site.linked_events} controls={actions.linkControls} />
            <SiteChanges key={revision} siteId={site.id} />
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
    </PageShell>
  );
}

"use client";

import { useRef, useState } from "react";
import { useParams } from "next/navigation";

import { PageColumns, PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { EventSection } from "@/components/event/EventLayout";
import { SiteDetails } from "@/components/sites/SiteFacts";
import { SiteChanges } from "@/components/sites/SiteChanges";
import { SITE_IMAGE_NAMES, siteImageExtras } from "@/components/sites/SiteImageBlock";
import { SourceBlocks } from "@/components/sources/SourceBlock";
import { LinkedEventRows, NearbyEvents } from "@/components/sites/SiteEventLists";
import { SiteLocation } from "@/components/sites/SiteLocation";
import { nearbyCandidate, useSiteActions } from "@/components/sites/useSiteActions";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import {
  HISTORY_ORDER_LABELS,
  contourFromImage,
  latestImage,
  siteNearbyEventsPath,
  sitePath,
  sortImages,
  sortLinkedEvents,
  type HistoryOrder,
  type Site,
  type SiteNearbyEvent,
} from "@/lib/sites";

type View = "images" | "events";

const ORDER_OPTIONS = (Object.keys(HISTORY_ORDER_LABELS) as HistoryOrder[]).map((value) => ({
  value,
  label: HISTORY_ORDER_LABELS[value],
}));

// Below `lg` the map sits under the lists, so a pick scrolls it into view.
const NARROW = "(max-width: 1023.98px)";

/**
 * A site's page, on the event page's frame: the title section and the pinned actions on
 * `PageShell`, then a `PageColumns` body. The main column switches between the imagery history
 * and the linked events, both read by date on the ground or by date added, and ends on the
 * nearby events nobody linked. The side column holds the event page's Location block, which
 * shows the zone of the picked image's date, then its Details block. Below `lg` the side column
 * follows the main column, the event page's order.
 */
export default function SitePage() {
  const params = useParams();
  const { user } = useAuth();
  const siteId = typeof params.id === "string" ? params.id : "";
  const { data: site, error, refetch } = useApiResource<Site>(siteId ? sitePath(siteId) : null);
  const nearby = useApiResource<SiteNearbyEvent[]>(site ? siteNearbyEventsPath(site.id) : null);
  const [view, setView] = useState<View>("images");
  const [order, setOrder] = useState<HistoryOrder>("fact");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  // Bumped by every write, so the changes on record read the history again.
  const [revision, setRevision] = useState(0);
  const refreshed = () => {
    refetch();
    nearby.refetch();
    setRevision((n) => n + 1);
  };
  const actions = useSiteActions({ site, nearby: nearby.data, onChanged: refreshed });

  if (error) return <PageError message={error} backHref="/map" />;
  if (!site) return <PageLoading />;

  const picked = site.images.find((i) => i.id === pickedId) ?? latestImage(site.images);
  const show = (id: string) => {
    setPickedId(id);
    if (window.matchMedia(NARROW).matches) zoneRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  const images = sortImages(site.images, order);
  const events = sortLinkedEvents(site.linked_events, order);

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
        stickySide
        main={
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <SegmentedControl<View>
                aria-label="View"
                value={view}
                onChange={setView}
                options={[
                  { value: "images", label: `Imagery history (${site.images.length})` },
                  { value: "events", label: `Linked events (${site.linked_events.length})` },
                ]}
              />
              <span className="flex items-center gap-1.5 max-sm:w-full">
                <SegmentedControl<HistoryOrder>
                  aria-label="Order by"
                  value={order}
                  onChange={setOrder}
                  options={ORDER_OPTIONS}
                />
                <FieldHelp concept="site_history" />
              </span>
            </div>

            {view === "images" ? (
              <SourceBlocks
                sources={images}
                alt={site.name}
                names={SITE_IMAGE_NAMES}
                extras={(image) =>
                  siteImageExtras({
                    image,
                    contour: contourFromImage(site.contours, image.id),
                    shown: image.id === picked?.id,
                    onShow: () => show(image.id),
                  })
                }
              />
            ) : (
              <LinkedEventRows events={events} />
            )}

            <SiteChanges
              key={`${view}-${order}-${revision}`}
              siteId={site.id}
              order={order}
              kinds={view === "images" ? ["record_edited"] : ["event_unlinked", "link_effect_changed"]}
            />

            <NearbyEvents
              events={nearby.data}
              error={nearby.error}
              viewerId={user?.id ?? null}
              onLink={(event) => actions.openLink(nearbyCandidate(event))}
            />
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

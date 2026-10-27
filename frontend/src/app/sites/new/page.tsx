"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPinPlus, TriangleAlert } from "lucide-react";

import { EventSection } from "@/components/event/EventLayout";
import { EventShell } from "@/components/event/EventShell";
import { SourcesRow } from "@/components/sources/SourcesRow";
import { PageColumns, PageLoading } from "@/components/ui/PageShell";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";
import { SiteKindCard, SiteNameField } from "@/components/sites/SiteFormFields";
import { SiteImageEditor, SiteWriteActions, useSiteImageDraft } from "@/components/sites/SiteImageEditor";
import { SiteLinksField, linkPayload, type DraftLink } from "@/components/sites/SiteLinksField";
import { ZoneEditor, useDrawHistory } from "@/components/sites/ZoneEditor";
import { useSitesInView } from "@/components/sites/useSitesInView";
import { useMapState } from "@/contexts/MapStateContext";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { cn } from "@/lib/cn";
import { EMPTY_DRAW, drawReady, zoneFromVertices } from "@/lib/siteZone";
import {
  SITE_KIND_LABELS,
  checkOverlaps,
  createSite,
  siteHref,
  type SiteKind,
  type SiteOverlap,
} from "@/lib/sites";
import { sourceName, sourceWriteError } from "@/lib/sources";

/** Probe for duplicates once the drawing rests. */
const OVERLAP_DEBOUNCE_MS = 500;

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** The overlap warning: each site whose current zone shares area with the drawn contour, with
 *  both shares. It never blocks, since a position inside a base is a site of its own. */
function OverlapWarning({ overlaps }: { overlaps: SiteOverlap[] }) {
  if (overlaps.length === 0) return null;
  return (
    <div role="status" className={cn("space-y-2 rounded-lg px-4 py-3 text-sm", WARNING_CALLOUT)}>
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert size={15} className="shrink-0" />
        {overlaps.length === 1
          ? "This contour overlaps an existing site"
          : `This contour overlaps ${overlaps.length} existing sites`}
      </p>
      <p className="text-xs">
        Check that it is not the same place. A site inside another one, such as a position
        inside a base, is not a duplicate. The warning does not block the creation.
      </p>
      <ul className="space-y-1.5">
        {overlaps.map((overlap) => (
          <li key={overlap.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span>
              <Link href={siteHref(overlap.id)} target="_blank" className={TEXT_LINK}>
                {overlap.name}
              </Link>{" "}
              <span className="text-xs">{SITE_KIND_LABELS[overlap.kind]}</span>
            </span>
            <span className="text-xs">
              {percent(overlap.share_of_new_zone)} of your contour,{" "}
              {percent(overlap.share_of_existing_zone)} of theirs
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Creates a site, on the site page's frame: the name typed in the page title like an event form's
 * Title, the write pinned top right, the Sources section with the first source then the Linked
 * events block with the creator's events in the main column, then the side column's Location
 * section, the contour drawn on the map, and its Details section, the kind. Below `lg` the side
 * column follows the main column, the site page's order. A contour that shares area with an
 * existing site raises a warning naming both shares. One `POST /sites` writes it all.
 */
export default function NewSitePage() {
  const router = useRouter();
  const { user, loading } = useRequireAuth();
  const { viewState } = useMapState();
  const history = useDrawHistory(EMPTY_DRAW);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SiteKind | "">("");
  const [links, setLinks] = useState<DraftLink[]>([]);
  const image = useSiteImageDraft();
  const [overlaps, setOverlaps] = useState<SiteOverlap[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [sites, onBoundsChange] = useSitesInView();

  const zone = drawReady(history.state) ? zoneFromVertices(history.state.vertices) : null;
  const zoneKey = zone ? JSON.stringify(zone.coordinates) : "";

  useDebouncedEffect(
    () => {
      if (!zone) {
        setOverlaps([]);
        return;
      }
      const controller = new AbortController();
      checkOverlaps(zone, controller.signal)
        .then(setOverlaps)
        .catch(() => {});
      return () => controller.abort();
    },
    [zoneKey],
    OVERLAP_DEBOUNCE_MS,
  );

  const missing = [
    ...image.missing,
    ...(zone ? [] : ["A closed contour"]),
    ...(name.trim() ? [] : ["Name"]),
    ...(kind ? [] : ["Kind"]),
  ];
  const flagged = attempt > 0;

  const create = useMutation(
    () =>
      createSite({
        name: name.trim(),
        kind: kind as SiteKind,
        contour: zone!,
        image: image.payload(),
        event_links: linkPayload(links),
      }),
    {
      fallback: "The site was not created. Try again.",
      onError: sourceWriteError,
      onSuccess: (site) => router.push(siteHref(site.id)),
    },
  );

  const submit = () => {
    setAttempt((n) => n + 1);
    if (missing.length > 0) return;
    if (image.held) {
      create.setError(image.held);
      return;
    }
    void create.run();
  };

  if (loading || !user) return <PageLoading />;

  return (
    <EventShell
      title="New site"
      titleField={<SiteNameField value={name} onChange={setName} invalid={flagged && !name.trim()} />}
      byline="File the first source, draw the contour it shows and name the site."
      backFallback="/map"
      actions={{
        pinned: (
          <SiteWriteActions
            label="Create the site"
            busyLabel="Creating…"
            icon={<MapPinPlus size={14} />}
            missing={missing}
            attempt={attempt}
            busy={create.loading}
            error={create.error}
            onWrite={submit}
          />
        ),
      }}
      panels={
        <PageColumns
          main={
            <>
              <SourcesRow count={1} invalid={flagged && image.missing.length > 0}>
                <SiteImageEditor state={image} flagged={flagged} name={sourceName(0)} />
              </SourcesRow>
              <SiteLinksField links={links} onChange={setLinks} author={user} />
            </>
          }
          side={
            <>
              <EventSection
                name="location"
                concept="site_location"
                besideScroller
                slot={{
                  invalid: flagged && !zone,
                  content: (
                    <div className="space-y-3">
                      <ZoneEditor
                        label="Contour"
                        history={history}
                        sites={sites}
                        center={{ lat: viewState.latitude, lng: viewState.longitude, zoom: viewState.zoom }}
                        onBoundsChange={onBoundsChange}
                        invalid={flagged && !zone}
                      />
                      <OverlapWarning overlaps={overlaps} />
                    </div>
                  ),
                }}
              />
              <EventSection
                name="details"
                concept="site_details"
                slot={{
                  invalid: flagged && !kind,
                  content: <SiteKindCard value={kind} onChange={setKind} invalid={flagged && !kind} />,
                }}
              />
            </>
          }
        />
      }
    />
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPinPlus, TriangleAlert } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { CharCounter } from "@/components/ui/CharCounter";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { Input, Select } from "@/components/ui/Input";
import { PageColumns, PageLoading, PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { META_LINE, TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";
import { SiteImageEditor, SiteWriteActions, useSiteImageDraft } from "@/components/sites/SiteImageEditor";
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
  SITE_KINDS,
  SITE_NAME_MAX_LEN,
  checkOverlaps,
  createSite,
  siteHref,
  type SiteKind,
  type SiteOverlap,
} from "@/lib/sites";
import { sourceWriteError } from "@/lib/sources";

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
 * Creates a site: the contour drawn on the map, a name and a kind, and the first dated image the
 * contour is drawn from. The page reads like an event form: the writes pinned top right, the
 * contour and the image in the main column, the site's name and kind in the side column. A
 * contour that shares area with an existing site raises a warning naming both shares.
 */
export default function NewSitePage() {
  const router = useRouter();
  const { user, loading } = useRequireAuth();
  const { viewState } = useMapState();
  const history = useDrawHistory(EMPTY_DRAW);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SiteKind | "">("");
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
    ...(zone ? [] : ["A closed contour"]),
    ...(name.trim() ? [] : ["Name"]),
    ...(kind ? [] : ["Kind"]),
    ...image.missing,
  ];
  const flagged = attempt > 0;

  const create = useMutation(
    () =>
      createSite({
        name: name.trim(),
        kind: kind as SiteKind,
        contour: zone!,
        image: image.payload(),
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
    <PageShell
      back
      backFallback="/map"
      title="New site"
      subtitle="Draw the contour over the first image, name the site and file that image."
      headerSide={null}
      stickyActions={
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
      }
    >
      <PageColumns
        main={
          <>
            <section className="space-y-3">
              <SectionEyebrow title="Contour" concept="site_zone" besideScroller margin="none" />
              <ZoneEditor
                label="Contour"
                history={history}
                sites={sites}
                center={{ lat: viewState.latitude, lng: viewState.longitude, zoom: viewState.zoom }}
                onBoundsChange={onBoundsChange}
                invalid={flagged && !zone}
              />
              <OverlapWarning overlaps={overlaps} />
            </section>
            <section>
              <SectionEyebrow title="First image" concept="site_image" besideScroller />
              <SiteImageEditor state={image} flagged={flagged} name="First image" />
            </section>
          </>
        }
        side={
          <section>
            <SectionEyebrow title="Site" besideScroller />
            <Card dense>
              <div className="space-y-1.5">
                <FieldLabel
                  label="Name"
                  htmlFor="site-name"
                  invalid={flagged && !name.trim()}
                  trailing={<CharCounter length={name.length} max={SITE_NAME_MAX_LEN} />}
                />
                <Input
                  id="site-name"
                  value={name}
                  maxLength={SITE_NAME_MAX_LEN}
                  invalid={flagged && !name.trim()}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="For example Northern fuel depot"
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel label="Kind" concept="site_kind" htmlFor="site-kind" invalid={flagged && !kind} />
                <Select
                  id="site-kind"
                  value={kind}
                  required
                  invalid={flagged && !kind}
                  onChange={(e) => setKind(e.target.value as SiteKind | "")}
                >
                  <option value="">Pick a kind</option>
                  {SITE_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {SITE_KIND_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </div>
              <p className={META_LINE}>
                You own the site: only you rename it and redraw its contour.
              </p>
            </Card>
          </section>
        }
      />
    </PageShell>
  );
}

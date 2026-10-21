"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Circle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CharCounter } from "@/components/ui/CharCounter";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { Input, Select } from "@/components/ui/Input";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";
import { ObservationFields } from "@/components/sites/ObservationFields";
import { EMPTY_DRAW, ZoneEditor, drawReady } from "@/components/sites/ZoneEditor";
import { useSitesInView } from "@/components/sites/useSitesInView";
import type { DrawState } from "@/components/map/ZoneDrawMap";
import { useMapState } from "@/contexts/MapStateContext";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { zoneFromVertices } from "@/lib/siteZone";
import {
  EMPTY_OBSERVATION,
  SITE_NAME_MAX_LEN,
  SITE_TYPE_LABELS,
  checkOverlaps,
  createSite,
  labelOptions,
  observationBody,
  observationMissing,
  siteHref,
  todayUtc,
  type ObservationDraft,
  type SiteOverlap,
  type SiteType,
} from "@/lib/sites";

/** Probe for duplicates once the drawing rests. */
const OVERLAP_DEBOUNCE_MS = 500;

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * Creates a site: the zone drawn on the map, a name and a type, and the first observation that
 * proves it. A zone that shares area with an existing site raises a warning naming both shares;
 * it never blocks the create, since a site nested in another (a position inside a base) is legal.
 */
export default function NewSitePage() {
  const router = useRouter();
  const { user, loading } = useRequireAuth();
  const { viewState } = useMapState();
  const today = todayUtc();

  const [draw, setDraw] = useState<DrawState>(EMPTY_DRAW);
  const [name, setName] = useState("");
  const [siteType, setSiteType] = useState<SiteType | "">("");
  const [observation, setObservation] = useState<ObservationDraft>(EMPTY_OBSERVATION);
  const [overlaps, setOverlaps] = useState<SiteOverlap[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [sites, onBoundsChange] = useSitesInView();

  const zone = drawReady(draw) ? zoneFromVertices(draw.vertices) : null;
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
    ...(name.trim() ? [] : ["Name"]),
    ...(name.length > SITE_NAME_MAX_LEN ? [`A name under ${SITE_NAME_MAX_LEN} characters`] : []),
    ...(siteType ? [] : ["Site type"]),
    ...observationMissing(observation, zone, today),
  ];
  const checklist = [
    { label: "Zone closed", met: zone !== null },
    { label: "Name and type", met: !!name.trim() && !!siteType },
    { label: "Provider and capture date", met: !!observation.provider && !!observation.capturedOn },
    {
      label: "Image URL for Other",
      met: observation.provider !== "other" || !!observation.url.trim(),
    },
  ];

  const create = useMutation(
    () =>
      createSite({
        name: name.trim(),
        site_type: siteType as SiteType,
        observation: observationBody(observation, zone!),
      }),
    {
      fallback: "Failed to create the site",
      onSuccess: (site) => router.push(siteHref(site.id)),
    },
  );

  const submit = () => {
    if (missing.length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    void create.run();
  };

  if (loading || !user) return <PageLoading />;

  const rail = (
    <div className="space-y-4">
      <Card as="section">
        <SectionEyebrow title="Before you publish" margin="none" />
        <ul className="flex flex-wrap gap-1.5">
          {checklist.map((item) => (
            <li key={item.label}>
              <Pill
                tone={item.met ? "secondary" : "neutral"}
                icon={item.met ? <Check size={12} strokeWidth={2.5} /> : <Circle size={9} strokeWidth={2} />}
              >
                {item.label}
              </Pill>
            </li>
          ))}
        </ul>
        {attempt > 0 && <IncompleteFormNotice key={attempt} missing={missing} />}
        {create.error && (
          <div className={FORM_ERROR_BANNER} role="alert">
            {create.error}
          </div>
        )}
        <Button variant="primary" fullWidth disabled={create.loading} onClick={submit}>
          {create.loading ? "Creating…" : "Create site"}
        </Button>
      </Card>
      <p className="text-xs text-neutral-500">
        You become the owner of the site. Until another analyst links an event to it, the site shows
        as not corroborated and the map draws it faded: at every zoom for you, from zoom 10 only for
        everyone else.
      </p>
    </div>
  );

  return (
    <PageShell
      back
      backFallback="/map"
      title="New site"
      subtitle="Draw the zone, name the site, and record the first observation that proves it."
      rail={rail}
      railLabel="Create the site"
      narrowRail="below"
    >
      <div className="space-y-6">
        <section>
          <SectionEyebrow title="Zone" concept="site_zone" />
          <ZoneEditor
            state={draw}
            onChange={setDraw}
            sites={sites}
            center={{ lat: viewState.latitude, lng: viewState.longitude, zoom: viewState.zoom }}
            onBoundsChange={onBoundsChange}
          />
        </section>

        {overlaps.length > 0 && (
          <div role="status" className={`${WARNING_CALLOUT} space-y-3 rounded-lg p-4 text-sm`}>
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle size={16} className="shrink-0" />
              {overlaps.length === 1
                ? "This zone overlaps an existing site"
                : `This zone overlaps ${overlaps.length} existing sites`}
            </p>
            <p className="text-xs opacity-80">
              Check that it is not the same place. A site inside another one, such as a position
              inside a base, is not a duplicate.
            </p>
            <ul className="space-y-1.5">
              {overlaps.map((overlap) => (
                <li key={overlap.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span>
                    <Link href={siteHref(overlap.id)} target="_blank" className={TEXT_LINK}>
                      {overlap.name}
                    </Link>{" "}
                    <span className="text-xs opacity-80">{SITE_TYPE_LABELS[overlap.site_type]}</span>
                  </span>
                  <span className="text-xs">
                    {percent(overlap.share_of_new_zone)} of your zone,{" "}
                    {percent(overlap.share_of_existing_zone)} of theirs
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Card as="section">
          <SectionEyebrow title="Site" margin="none" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="flex items-center justify-between gap-2">
                <label htmlFor="site-name" className={FORM_LABEL}>
                  Name
                </label>
                <CharCounter length={name.length} max={SITE_NAME_MAX_LEN} />
              </span>
              <Input
                id="site-name"
                value={name}
                invalid={name.length > SITE_NAME_MAX_LEN}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Northern fuel depot"
              />
            </div>
            <div className="space-y-1.5">
              <span className="flex items-center gap-1">
                <label htmlFor="site-type" className={FORM_LABEL}>
                  Type
                </label>
                <FieldHelp concept="site_type" size={12} />
              </span>
              <Select
                id="site-type"
                value={siteType}
                onChange={(e) => setSiteType(e.target.value as SiteType | "")}
              >
                <option value="">Pick a type</option>
                {labelOptions(SITE_TYPE_LABELS).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Card>

        <Card as="section">
          <SectionEyebrow title="First observation" concept="site_observation" margin="none" />
          <ObservationFields draft={observation} onChange={setObservation} today={today} />
        </Card>
      </div>
    </PageShell>
  );
}

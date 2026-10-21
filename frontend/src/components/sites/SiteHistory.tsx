"use client";

import { useState } from "react";
import Link from "next/link";
import { MapPinned } from "lucide-react";

import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { META_LINE, TEXT_LINK } from "@/components/ui/styles";
import { useApiResource } from "@/hooks/useApiResource";
import { formatDate } from "@/lib/format";
import { eventHref } from "@/lib/routes";
import {
  IMAGERY_PROVIDER_LABELS,
  LINK_EFFECT_LABELS,
  formatDistance,
  siteHistoryPath,
  type HistoryOrder,
  type Site,
  type SiteHistoryEntry,
} from "@/lib/sites";
import { LinkEffectPill, ObservationEffectPill } from "./SiteBadges";

const CLOCKS: { value: HistoryOrder; label: string }[] = [
  { value: "fact", label: "Date on the ground" },
  { value: "recorded", label: "Date added to Vidit" },
];

const KIND_TITLE: Record<SiteHistoryEntry["kind"], string> = {
  site_created: "Site created",
  observation_added: "Observation",
  event_linked: "Event linked",
  event_unlinked: "Event unlinked",
  link_effect_changed: "Link effect changed",
};

/** The date an entry sits at under each clock. A null ground date reads as its recording day,
 *  where the API places it. */
function entryDate(entry: SiteHistoryEntry, order: HistoryOrder): string {
  return order === "fact" && entry.fact_date ? entry.fact_date : entry.recorded_at;
}

function otherClock(entry: SiteHistoryEntry, order: HistoryOrder): string | null {
  if (order === "recorded") return entry.fact_date ? `On the ground ${formatDate(entry.fact_date)}` : null;
  return `Added ${formatDate(entry.recorded_at)}`;
}

/**
 * The site's history, newest first, under one of its two clocks: when each fact happened on
 * the ground, or when it entered Vidit. An observation entry shows its zone on the site map.
 */
export function SiteHistory({
  site,
  shownObservationId,
  onShowObservation,
}: {
  site: Site;
  shownObservationId: string;
  onShowObservation: (id: string) => void;
}) {
  const [order, setOrder] = useState<HistoryOrder>("fact");
  const { data, error } = useApiResource<SiteHistoryEntry[]>(siteHistoryPath(site.id, order));
  const linked = new Map(site.linked_events.map((e) => [e.id, e]));
  const latestObservationId = site.observations.at(-1)?.id;

  return (
    <section>
      <SectionEyebrow title="History" concept="site_history" />
      <div className="mb-3">
        <SegmentedControl aria-label="History clock" options={CLOCKS} value={order} onChange={setOrder} />
      </div>
      {error ? (
        <div className={FORM_ERROR_BANNER}>{error}</div>
      ) : !data ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : data.length === 0 ? (
        <EmptyState variant="plain" lead="Nothing recorded yet." />
      ) : (
        <Card className="p-0">
          <ol>
            {[...data].reverse().map((entry, i) => {
              const event = entry.event ? linked.get(entry.event.id) : undefined;
              const other = otherClock(entry, order);
              const shown = entry.observation_id === shownObservationId;
              return (
                <li
                  key={`${entry.kind}-${entry.recorded_at}-${i}`}
                  className="flex gap-4 px-4 py-3 border-b border-neutral-800 last:border-b-0"
                >
                  <span className="w-24 shrink-0 pt-0.5 text-xs text-neutral-500">
                    {formatDate(entryDate(entry, order))}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm text-neutral-100">
                      {entry.event ? (
                        <>
                          <span className="text-neutral-400">{KIND_TITLE[entry.kind]}: </span>
                          <Link href={eventHref(entry.event.id)} className={TEXT_LINK}>
                            {entry.event.title}
                          </Link>
                        </>
                      ) : entry.kind === "observation_added" && entry.imagery_provider ? (
                        `${KIND_TITLE[entry.kind]}: ${IMAGERY_PROVIDER_LABELS[entry.imagery_provider]} imagery`
                      ) : (
                        KIND_TITLE[entry.kind]
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
                      {entry.observation_effect && <ObservationEffectPill effect={entry.observation_effect} />}
                      {entry.link_effect && <LinkEffectPill effect={entry.link_effect} />}
                      {entry.previous_link_effect && (
                        <Pill tone="neutral" label="Was">
                          {LINK_EFFECT_LABELS[entry.previous_link_effect]}
                        </Pill>
                      )}
                      {entry.kind === "event_linked" && event && (
                        <Pill tone="neutral">
                          {event.inside_zone
                            ? "Inside the zone"
                            : `Outside the zone, ${formatDistance(event.distance_m ?? 0)}`}
                        </Pill>
                      )}
                      {entry.observation_id === latestObservationId && <Pill tone="neutral">Latest zone</Pill>}
                      {entry.observation_id &&
                        (shown ? (
                          <Pill tone="accent" icon={<MapPinned size={11} />}>
                            Shown on the map
                          </Pill>
                        ) : (
                          <Button variant="ghost" onClick={() => onShowObservation(entry.observation_id!)}>
                            Show this zone
                          </Button>
                        ))}
                    </div>
                    <p className={META_LINE}>
                      {entry.actor && <AuthorByline author={entry.actor} size="xs" />}
                      {other && <span>{other}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </section>
  );
}

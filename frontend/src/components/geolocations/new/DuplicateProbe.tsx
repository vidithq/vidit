"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN } from "@/lib/coordinates";
import { formatDate } from "@/lib/format";
import type { PossibleDuplicate } from "@/types";
import { WARNING_CALLOUT } from "@/components/ui/styles";

// "User paused typing" threshold.
const DUPLICATE_PROBE_DEBOUNCE_MS = 500;

interface DuplicateProbeProps {
  lat: string;
  lng: string;
  sourceUrl: string;
  eventDate: string;
  /** Fulfilment mode skips the probe: the locked source URL would re-surface the
   *  request itself. */
  skip: boolean;
}

/**
 * Possible-duplicate probe and inline warning, fired after a debounce on change
 * of coords, source URL or event date. The backend drops unusable legs (none
 * usable returns []), so it is safe to call while typing. Renders nothing until
 * candidates surface; never blocks submission.
 */
export function DuplicateProbe({
  lat,
  lng,
  sourceUrl,
  eventDate,
  skip,
}: DuplicateProbeProps) {
  const [hits, setHits] = useState<PossibleDuplicate[]>([]);

  // Null when this edit can't be probed: fulfilment mode, missing or out-of-range
  // coords (the always-on proximity leg), or no source URL and no event date.
  const query = useMemo(() => {
    if (skip) return null;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (
      Number.isNaN(latNum) ||
      Number.isNaN(lngNum) ||
      latNum < LAT_MIN ||
      latNum > LAT_MAX ||
      lngNum < LNG_MIN ||
      lngNum > LNG_MAX
    ) {
      return null;
    }
    if (!sourceUrl && !eventDate) return null;
    const params = new URLSearchParams({
      lat: latNum.toString(),
      lng: lngNum.toString(),
    });
    if (sourceUrl) params.set("source_url", sourceUrl);
    if (eventDate) params.set("event_date", eventDate);
    return params.toString();
  }, [lat, lng, sourceUrl, eventDate, skip]);

  // Not debounced: an unprobeable edit drops the warning on the keystroke.
  useEffect(() => {
    if (query === null) setHits([]);
  }, [query]);

  useDebouncedEffect(
    () => {
      if (query === null) return;
      const controller = new AbortController();
      apiFetch<PossibleDuplicate[]>(`/events/possible-duplicates?${query}`, {
        signal: controller.signal,
      })
        .then((rows) => {
          if (controller.signal.aborted) return;
          setHits(rows);
        })
        .catch(() => {
          // Drop failures (429 from rapid edits, 5xx, network) without clearing
          // hits, so a transient 429 doesn't wipe a warning in view.
        });
      return () => controller.abort();
    },
    [query],
    DUPLICATE_PROBE_DEBOUNCE_MS,
  );

  if (hits.length === 0) return null;
  return <DuplicateWarning hits={hits} />;
}

/**
 * Inline warning listing duplicate candidates; each row opens the existing
 * geolocation in a new tab to keep the in-progress form. The card is amber;
 * clickable affordances stay orange (`design.md`).
 */
function DuplicateWarning({ hits }: { hits: PossibleDuplicate[] }) {
  return (
    <section
      className={`rounded-md p-4 space-y-3 ${WARNING_CALLOUT}`}
      aria-live="polite"
    >
      <header className="flex items-start gap-2 text-amber-200">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h2 className="text-sm font-medium">
            {hits.length === 1
              ? "1 possibly related geolocation"
              : `${hits.length} possibly related geolocations`}
          </h2>
          <p className="text-xs text-amber-200/80">
            Same area + matching source or event date. Check before
            submitting; submission isn&apos;t blocked.
          </p>
        </div>
      </header>
      <ul className="space-y-1.5">
        {hits.map((hit) => (
          <li key={hit.id}>
            <Link
              href={`/events/${hit.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 px-3 py-2 bg-neutral-900/60 border border-neutral-700 rounded-md hover:border-orange-500/50 hover:bg-neutral-900 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutral-100 truncate">
                  {hit.title}
                </p>
                <p className="text-xs text-neutral-400">
                  {hit.event_date ? `${formatDate(hit.event_date)} · ` : ""}@
                  {hit.owner.username} · {formatDistance(hit.distance_m)}
                </p>
              </div>
              <span className="text-xs text-orange-400 shrink-0">
                Open ↗
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Metres as "N m" rounded to 10m (the phone-GPS jitter floor), or "N.N km" from
 * 1km. Negatives clamp so a stray `-0.0` doesn't print "-0 m". The threshold
 * compares the rounded value, so 995m reads "1.0 km".
 */
function formatDistance(distanceM: number): string {
  const clamped = Math.max(0, distanceM);
  const rounded10m = Math.round(clamped / 10) * 10;
  if (rounded10m < 1000) {
    return `${rounded10m} m`;
  }
  return `${(clamped / 1000).toFixed(1)} km`;
}

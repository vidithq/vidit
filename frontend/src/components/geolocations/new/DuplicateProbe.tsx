"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { PossibleDuplicate } from "@/types";
import { WARNING_CALLOUT } from "@/components/ui/styles";

// Debounce signal-field edits so we don't probe per keystroke.
// 500ms is the standard "user paused typing" threshold.
const DUPLICATE_PROBE_DEBOUNCE_MS = 500;

interface DuplicateProbeProps {
  lat: string;
  lng: string;
  sourceUrl: string;
  eventDate: string;
  /** Bounty-fulfilment mode skips the probe: the source URL is locked to
   *  the bounty's, so the host leg would re-surface the bounty itself. */
  skip: boolean;
}

/**
 * Possible-duplicate probe + inline warning, fired on signal-field
 * (coords, source URL, event date) change after a debounce. The backend
 * tolerates partial / malformed inputs (an unusable leg is just dropped,
 * no usable leg → []), so it's safe to call eagerly while the user types.
 * Renders nothing until candidates surface; never blocks submission.
 */
export function DuplicateProbe({
  lat,
  lng,
  sourceUrl,
  eventDate,
  skip,
}: DuplicateProbeProps) {
  // Soft warning: rows surfaced as "maybe the same event".
  const [hits, setHits] = useState<PossibleDuplicate[]>([]);

  useEffect(() => {
    if (skip) return;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    // Need coords at minimum — proximity is the always-on leg. With no
    // source URL or event date the backend returns []; drop to skip it.
    if (
      Number.isNaN(latNum) ||
      Number.isNaN(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      setHits([]);
      return;
    }
    if (!sourceUrl && !eventDate) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        lat: latNum.toString(),
        lng: lngNum.toString(),
      });
      if (sourceUrl) params.set("source_url", sourceUrl);
      if (eventDate) params.set("event_date", eventDate);
      apiFetch<PossibleDuplicate[]>(
        `/events/possible-duplicates?${params.toString()}`,
        { signal: controller.signal },
      )
        .then((rows) => {
          if (controller.signal.aborted) return;
          setHits(rows);
        })
        .catch(() => {
          // Soft warning: drop on any failure (429 from rapid edits, 5xx,
          // network) without clearing hits. A transient 429 mid-typing
          // would otherwise wipe a warning the analyst is looking at; the
          // next successful fetch overwrites, so a stale list stays truthful.
        });
    }, DUPLICATE_PROBE_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [lat, lng, sourceUrl, eventDate, skip]);

  if (hits.length === 0) return null;
  return <DuplicateWarning hits={hits} />;
}

/**
 * Inline soft-warning listing duplicate candidates; each row opens the
 * existing geolocation in a new tab to preserve the in-progress form.
 *
 * Palette split per `design.md`: the card stays amber ("warning, not
 * error"), but clickable affordances are orange to honour the "if it's
 * clickable, it's orange" rule the rest of the app reads by.
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
                  {hit.author.username} · {formatDistance(hit.distance_m)}
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
 * Format a metres distance: <1km → "N m" rounded to 10m (the phone-GPS
 * jitter floor), ≥1km → "N.N km". Clamp negatives so a stray ``-0.0``
 * from a float round-trip doesn't print as "-0 m". The km/m threshold
 * compares the rounded value, so 995m → "1.0 km", not "1000 m".
 */
function formatDistance(distanceM: number): string {
  const clamped = Math.max(0, distanceM);
  const rounded10m = Math.round(clamped / 10) * 10;
  if (rounded10m < 1000) {
    return `${rounded10m} m`;
  }
  return `${(clamped / 1000).toFixed(1)} km`;
}

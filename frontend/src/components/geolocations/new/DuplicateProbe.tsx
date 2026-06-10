"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { PossibleDuplicate } from "@/types";

// Coords + source-url + event-date go through this debounce before we
// fire the duplicate probe so we don't slam the endpoint per keystroke.
// 500ms is the standard "user paused typing" threshold — short enough
// that the warning lands while the analyst is still on the form, long
// enough that we're not chasing every digit of a longitude.
const DUPLICATE_PROBE_DEBOUNCE_MS = 500;

interface DuplicateProbeProps {
  lat: string;
  lng: string;
  sourceUrl: string;
  eventDate: string;
  /** Bounty-fulfilment mode skips the probe entirely: the bounty is
   *  the authoritative trace, "duplicating a bounty" doesn't apply
   *  (and the source URL is locked to the bounty's anyway, so the
   *  host leg would re-surface the bounty itself as a candidate). */
  skip: boolean;
}

/**
 * Possible-duplicate probe + inline warning. Fires whenever the signal
 * fields (coords, source URL, event date) change, after a short idle
 * debounce. The backend tolerates partial / malformed inputs (a
 * half-typed source URL just disables the host leg, a bad date
 * does the same for the date leg, no usable leg → empty array)
 * so it's safe to call eagerly while the user is still typing.
 *
 * Renders nothing until the probe surfaces candidates; never blocks
 * submission — the analyst skims and decides.
 */
export function DuplicateProbe({
  lat,
  lng,
  sourceUrl,
  eventDate,
  skip,
}: DuplicateProbeProps) {
  // Soft warning: rows the duplicate probe surfaces as "maybe the
  // same event". Cleared / re-fetched whenever the signal fields
  // change.
  const [hits, setHits] = useState<PossibleDuplicate[]>([]);

  useEffect(() => {
    if (skip) return;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    // Need coords at minimum — proximity is the always-on leg. If
    // both source URL and event date are still empty, the backend
    // will return [] anyway; we drop here to skip the round trip.
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
        `/geolocations/possible-duplicates?${params.toString()}`,
        { signal: controller.signal },
      )
        .then((rows) => {
          if (controller.signal.aborted) return;
          setHits(rows);
        })
        .catch(() => {
          // Soft warning — silently drop on any failure (429 rate
          // limit from rapid edits, 5xx, network blip). The form
          // remains submittable; we're not blocking on this signal.
          //
          // Deliberately do NOT clear the previous result here: a
          // transient 429 mid-typing would otherwise wipe a warning
          // the analyst was already looking at, with no explanation.
          // The next successful fetch overwrites; if no fetch ever
          // succeeds the analyst sees a stale-but-truthful list (the
          // candidates were real at the moment they were fetched).
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
 * Inline soft-warning rendered above the submit button when the
 * duplicate probe surfaces candidates. Each row links to the existing
 * geolocation in a new tab so the analyst can sanity-check without
 * losing the in-progress form. Never blocks — the submit button stays
 * enabled; this is a "did you mean…" signal, not a gate.
 *
 * Palette split per `design.md`: the outer card stays amber (the
 * "warning, not error" semantic — same idiom as the gate page's
 * notification panel), but every clickable affordance inside is
 * orange. Without that split the card would violate the "if it's
 * clickable, it's orange" rule that the rest of the app reads by.
 */
function DuplicateWarning({ hits }: { hits: PossibleDuplicate[] }) {
  return (
    <section
      className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3"
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
            submitting — submission isn&apos;t blocked.
          </p>
        </div>
      </header>
      <ul className="space-y-1.5">
        {hits.map((hit) => (
          <li key={hit.id}>
            <Link
              href={`/geolocations/${hit.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 px-3 py-2 bg-neutral-900/60 border border-neutral-700 rounded-md hover:border-orange-500/50 hover:bg-neutral-900 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutral-100 truncate">
                  {hit.title}
                </p>
                <p className="text-xs text-neutral-400">
                  {formatDate(hit.event_date)} · @{hit.author.username} ·{" "}
                  {formatDistance(hit.distance_m)}
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
 * Render a metres distance compactly. <1km → "N m" rounded to 10m
 * (the GPS jitter floor for phone-grade coords), ≥1km → "N.N km"
 * with one decimal. Negative values are clamped to 0 (the backend
 * never returns negative distances, but a stray ``-0.0`` from a
 * float round-trip would print as "-0 m").
 *
 * The threshold compares the post-rounding value, not the raw
 * input: 995 m rounds to 1000 m, which should render as "1.0 km"
 * — not the contradictory "1000 m". Switching at the rounded
 * boundary avoids that artefact at the km/m crossover.
 */
function formatDistance(distanceM: number): string {
  const clamped = Math.max(0, distanceM);
  const rounded10m = Math.round(clamped / 10) * 10;
  if (rounded10m < 1000) {
    return `${rounded10m} m`;
  }
  return `${(clamped / 1000).toFixed(1)} km`;
}

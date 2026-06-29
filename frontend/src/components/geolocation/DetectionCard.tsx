"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, Film, MapPin, Pencil, X } from "lucide-react";

import StatusBadge from "@/components/geolocation/StatusBadge";
import SourceLabel from "@/components/ui/SourceLabel";
import { FORM_ERROR_BANNER_BOXED } from "@/components/ui/form-styles";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { TagBadge } from "@/components/ui/TagBadge";
import { useMutation } from "@/hooks/useMutation";
import { formatDate } from "@/lib/format";
import { rejectGeolocation, sourceIsSynthetic, submitReadiness } from "@/lib/geolocations";
import { displayUrlsFor } from "@/lib/mediaUrls";
import type { GeolocationDetail } from "@/types";

/**
 * One machine-`detected` row in the owner detections list. **Edit** opens the
 * full form at `/geolocations/{id}/edit`, where the owner edits and submits
 * (submission lives there so it always follows a complete read). **Delete**
 * (two-click) soft-deletes the detection here. `onActed` lets the parent refetch
 * once a row leaves the list.
 */
export default function DetectionCard({
  geo,
  onActed,
}: {
  geo: GeolocationDetail;
  onActed: () => void;
}) {
  const readiness = submitReadiness(geo);
  const [confirmingReject, setConfirmingReject] = useState(false);

  const rejectMut = useMutation(() => rejectGeolocation(geo.id), {
    fallback: "Couldn't delete this geolocation.",
    onSuccess: onActed,
  });

  const busy = rejectMut.loading;
  const actionError = rejectMut.error;
  const firstMedia = geo.media[0];
  const conflictTags = geo.tags.filter((t) => t.category === "conflict");
  const captureTags = geo.tags.filter((t) => t.category === "capture_source");
  const freeTags = geo.tags.filter((t) => t.category === "free");

  return (
    <div className="flex gap-4 p-3 bg-neutral-900 border border-neutral-700 rounded-lg">
      {/* Thumbnail — the real source media, the thing the owner judges. */}
      <div className="relative w-32 aspect-video rounded-md overflow-hidden bg-neutral-950 border border-neutral-800 shrink-0">
        {firstMedia ? (
          firstMedia.media_type === "image" ? (
            <Image
              src={displayUrlsFor(firstMedia).thumbnail}
              alt={geo.title}
              fill
              sizes="128px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-neutral-500">
              <Film size={18} />
            </div>
          )
        ) : (
          <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-neutral-600">
            No source media
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/geolocations/${geo.id}`}
            className="text-sm font-medium text-neutral-100 hover:text-orange-400 transition-colors truncate"
          >
            {geo.title}
          </Link>
          <StatusBadge status={geo.status} />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
          <span className="inline-flex items-center gap-1 font-mono">
            <MapPin size={10} />
            {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)}
          </span>
          <span>{formatDate(geo.event_date)}</span>
          {geo.detected_from_url && (
            <span className="inline-flex items-center gap-1">
              from
              <SourceLabel
                isDemo={sourceIsSynthetic(geo)}
                url={geo.detected_from_url}
                variant="link"
                maxWidthClass="max-w-[160px]"
              />
            </span>
          )}
        </div>

        {/* Always rendered, even with no chips, so a tagged vs tagless row is
            the same height and the cards stay aligned across the queue. */}
        <div className="flex flex-wrap gap-1.5 min-h-[1.375rem]">
          {[...conflictTags, ...captureTags, ...freeTags].map((t) => (
            <TagBadge key={t.id} name={t.name} className="text-[10px]" />
          ))}
        </div>

        {actionError && <div className={FORM_ERROR_BANNER_BOXED}>{actionError}</div>}

        {/* Readiness on the left, the three actions tucked into the bottom-right
            corner: one row instead of two keeps the card compact. Readiness is
            always rendered (ready or not) so the card height stays uniform; when
            blocked it's the nudge (machine rows are born tagless, edit to add
            the curated tags, then submit). */}
        <div className="flex items-start justify-between gap-3 pt-0.5">
          <div className="min-w-0">
            {readiness.isReady ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400">
                <Check size={12} /> Ready to submit.
              </span>
            ) : (
              // The submit floor as a single neutral line: the concrete reason a
              // submission is blocked, kept light (no chips).
              <span className="text-[11px] text-neutral-500">
                To submit: {readiness.missing.join(", ")}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/geolocations/${geo.id}/edit`}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs ${PRIMARY_BUTTON}`}
            >
              <Pencil size={13} />
              Edit
            </Link>

            {/* Two-click confirm so a stray click can't soft-delete a detection. */}
            {confirmingReject ? (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => rejectMut.run()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40 transition-colors"
                >
                  <Check size={13} />
                  {rejectMut.loading ? "Deleting…" : "Confirm delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReject(false)}
                  disabled={busy}
                  className="px-2 py-1.5 rounded-md text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
                  aria-label="Cancel delete"
                >
                  <X size={13} />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingReject(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-neutral-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
              >
                <X size={13} />
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

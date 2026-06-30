"use client";

import Link from "next/link";
import { Check, Pencil, X } from "lucide-react";

import StatusBadge from "@/components/geolocation/StatusBadge";
import { EntityCard } from "@/components/ui/EntityCard";
import { FORM_ERROR_BANNER_BOXED } from "@/components/ui/form-styles";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import {
  rejectGeolocation,
  sourceIsSynthetic,
  submitReadiness,
} from "@/lib/geolocations";
import type { GeolocationDetail } from "@/types";

/**
 * One machine-`detected` row in the owner detections list. A thin wrapper over
 * the shared `EntityCard` (same shell as every other catalogue card) carrying
 * the detection-specific `actions`: **Edit** opens the full form at
 * `/geolocations/{id}/edit`; **Delete** (two-click) soft-deletes the detection
 * here. `onActed` lets the parent refetch once a row leaves the list.
 */
export default function DetectionCard({
  geo,
  onActed,
}: {
  geo: GeolocationDetail;
  onActed: () => void;
}) {
  const readiness = submitReadiness(geo);
  const rejectMut = useMutation(() => rejectGeolocation(geo.id), {
    fallback: "Couldn't delete this geolocation.",
    onSuccess: onActed,
  });
  const confirmReject = useConfirmAction(() => rejectMut.run());
  const busy = rejectMut.loading;
  const actionError = rejectMut.error;

  return (
    <EntityCard
      variant="compact"
      detailHref={`/geolocations/${geo.id}`}
      title={geo.title}
      titleText={geo.title}
      badge={<StatusBadge status={geo.status} />}
      media={geo.media[0]}
      date={geo.event_date}
      coords={{ lat: geo.lat, lng: geo.lng }}
      source={
        geo.detected_from_url
          ? { url: geo.detected_from_url, isDemo: sourceIsSynthetic(geo) }
          : undefined
      }
      tags={geo.tags}
      actions={
        <div className="space-y-2">
          {actionError && (
            <div className={FORM_ERROR_BANNER_BOXED}>{actionError}</div>
          )}
          {/* Readiness on the left, the actions tucked bottom-right. Readiness
              is always rendered (ready or not) so the card height stays uniform;
              when blocked it's the nudge to edit in the curated tags. */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {readiness.isReady ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400">
                  <Check size={12} /> Ready to submit.
                </span>
              ) : (
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

              {/* Two-click confirm so a stray click can't soft-delete. */}
              {confirmReject.armed ? (
                <span className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={confirmReject.trigger}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40 transition-colors"
                  >
                    <Check size={13} />
                    {rejectMut.loading ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button
                    type="button"
                    onClick={confirmReject.cancel}
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
                  onClick={confirmReject.trigger}
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
      }
    />
  );
}

"use client";

import { formatDate } from "@/lib/format";
import type { EventStatus } from "@/types";
import { ARMED_RING } from "@/components/ui/styles";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import ShareOnX, { openShareIntent } from "@/components/share/ShareOnX";

interface ShareButtonsProps {
  id: string;
  title: string;
  author: string;
  /** Nullable: a coordless event (a ``requested`` row) has no date/coords line. */
  eventDate: string | null;
  lat: number | null;
  lng: number | null;
  /** A `detected` row is a machine detection its owner can still edit, so a shared
   *  link's content may change. Surfaced as a caveat next to the share button. */
  status: EventStatus;
}

/**
 * Passing an event on: the X intent, prefilled with the title, the credit line
 * and the coordinates, plus the event's own URL. The intent and the button
 * itself are `<ShareOnX>`; this wrapper keeps the one thing an event share adds
 * over a plain one, the `detected` two-click confirm.
 *
 * One way out, not two. A reader who wants the address has it in the browser's
 * own address bar, so a copy button beside the share sat there to duplicate a
 * control every browser already carries; the coordinates, which the address bar
 * does not carry, keep their own copy in `<CoordinateActions>`.
 */
export default function ShareButtons({
  id,
  title,
  author,
  eventDate,
  lat,
  lng,
  status,
}: ShareButtonsProps) {
  const path = `/events/${id}`;
  const lines = [
    title,
    `by ${author}${eventDate ? ` · ${formatDate(eventDate)}` : ""}`,
    ...(lat != null && lng != null
      ? [`${lat.toFixed(6)}, ${lng.toFixed(6)}`]
      : []),
  ];

  // A `detected` link points at an editable detection, so sharing it asks for a
  // confirming re-click first (mirrors the review queue's two-click delete); a
  // submitted link acts on the first click, which never reaches `trigger` and so
  // never arms.
  const { armed, trigger } = useConfirmAction(
    () => openShareIntent(path, lines),
    { timeoutMs: ARM_MS },
  );
  const onShareX =
    status === "detected" ? trigger : () => openShareIntent(path, lines);

  return (
    <div className="flex items-center gap-1.5">
      {/* A detection is still editable, so a share arms on the first click;
          this neutral nudge (site DA, not a warning colour) asks for the
          confirming re-click. `role="status"` makes it the armed state's
          announcement too, so the button never has to rename itself. */}
      {armed && (
        <span role="status" className="text-[10px] text-neutral-400">
          Detected and may still change. Click again to share.
        </span>
      )}
      <ShareOnX
        path={path}
        lines={lines}
        onClick={onShareX}
        className={armed ? ARMED_RING : ""}
        title={armed ? "Click again to share this detection" : "Share on X"}
      />
    </div>
  );
}

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
  /** A `detected` row is editable by its owner, so a shared link's content may change: surfaced as a caveat. */
  status: EventStatus;
}

/**
 * Passing an event on: the X intent (title, credit line, coordinates, event URL). The intent and
 * button are `<ShareOnX>`; this wrapper keeps what an event share adds, the `detected` two-click
 * confirm. There is no copy-link button: the address bar already carries the URL, and the
 * coordinates keep their own copy in `<CoordinateActions>`.
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

  // A `detected` link points at an editable detection, so sharing asks for a confirming re-click
  // (mirrors the review queue's two-click delete); a submitted link acts on first click and never arms.
  const { armed, trigger } = useConfirmAction(
    () => openShareIntent(path, lines),
    { timeoutMs: ARM_MS },
  );
  const onShareX =
    status === "detected" ? trigger : () => openShareIntent(path, lines);

  return (
    <div className="flex items-center gap-1.5">
      {/* A detection is still editable, so a share arms on the first click; this neutral nudge asks for
          the re-click. `role="status"` announces the armed state, so the button never renames itself. */}
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

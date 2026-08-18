"use client";

import { formatDate } from "@/lib/format";
import type { EventStatus } from "@/types";
import { Button } from "@/components/ui/Button";
import { XGlyph } from "@/components/ui/BrandGlyphs";
import { ARMED_RING } from "@/components/ui/styles";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";

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
 * and the coordinates, plus the event's own URL.
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
  // A getter, not a value: it reads `window` and only ever runs from a click
  // handler, so there is no render-time path to guard.
  const url = () => `${window.location.origin}/events/${id}`;

  const tweetText = () =>
    [
      title,
      `by ${author}${eventDate ? ` · ${formatDate(eventDate)}` : ""}`,
      ...(lat != null && lng != null
        ? [`${lat.toFixed(6)}, ${lng.toFixed(6)}`]
        : []),
    ].join("\n");

  const openIntent = () => {
    // twitter.com/intent/tweet still serves the composer post-rebrand and is
    // the documented domain, so it won't be redirected away.
    const intent = new URL("https://twitter.com/intent/tweet");
    intent.searchParams.set("text", tweetText());
    intent.searchParams.set("url", url());
    window.open(intent.toString(), "_blank", "noopener,noreferrer");
  };

  // A `detected` link points at an editable detection, so sharing it asks for a
  // confirming re-click first (mirrors the review queue's two-click delete); a
  // submitted link acts on the first click, which never reaches `trigger` and so
  // never arms.
  const { armed, trigger } = useConfirmAction(openIntent, {
    timeoutMs: ARM_MS,
  });
  const onShareX = status === "detected" ? trigger : openIntent;

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
      <Button
        icon
        variant="ghost"
        onClick={onShareX}
        className={armed ? ARMED_RING : ""}
        aria-label="Share on X"
        title={armed ? "Click again to share this detection" : "Share on X"}
      >
        <XGlyph size={14} />
      </Button>
    </div>
  );
}

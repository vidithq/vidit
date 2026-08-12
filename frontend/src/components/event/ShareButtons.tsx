"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";
import type { EventStatus } from "@/types";
import { Button } from "@/components/ui/Button";
import { XGlyph } from "@/components/ui/BrandGlyphs";
import { CopyButton } from "@/components/ui/CopyButton";

interface ShareButtonsProps {
  id: string;
  title: string;
  author: string;
  /** Nullable: a coordless event (a ``requested`` row) has no date/coords line. */
  eventDate: string | null;
  lat: number | null;
  lng: number | null;
  /** A `detected` row is a machine draft its owner can still edit, so a shared
   *  link's content may change. Surfaced as a caveat next to the share row. */
  status: EventStatus;
}

// How long an armed share / copy waits for its confirming re-click.
const ARM_MS = 3000;

export default function ShareButtons({
  id,
  title,
  author,
  eventDate,
  lat,
  lng,
  status,
}: ShareButtonsProps) {
  // A `detected` link points at an editable draft, so sharing it asks for a
  // confirming re-click first (mirrors the review queue's two-click delete).
  // `armed` is which action is awaiting that re-click; it auto-disarms.
  // Held here rather than on `useConfirmAction` because the copy half is a
  // `<CopyButton>`, which owns the clipboard write and only takes a synchronous
  // go/no-go gate; one state machine covering both buttons beats two arming
  // mechanisms in one row.
  const [armed, setArmed] = useState<null | "copy" | "share">(null);
  const armResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armResetTimer.current) clearTimeout(armResetTimer.current);
    };
  }, []);

  // A submitted link acts on the first click; a detected one arms first, then acts.
  const needsConfirm = status === "detected";
  const arm = (which: "copy" | "share") => {
    setArmed(which);
    if (armResetTimer.current) clearTimeout(armResetTimer.current);
    armResetTimer.current = setTimeout(() => setArmed(null), ARM_MS);
  };
  const disarm = () => {
    setArmed(null);
    if (armResetTimer.current) clearTimeout(armResetTimer.current);
  };

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

  // Gate handed to `<CopyButton>`: a draft link arms on the first click and
  // only the second one reaches the clipboard write.
  const onCopy = () => {
    if (needsConfirm && armed !== "copy") {
      arm("copy");
      return false;
    }
    disarm();
    return true;
  };

  const onShareX = () => {
    if (needsConfirm && armed !== "share") {
      arm("share");
      return;
    }
    disarm();
    // twitter.com/intent/tweet still serves the composer post-rebrand and is
    // the documented domain, so it won't be redirected away.
    const intent = new URL("https://twitter.com/intent/tweet");
    intent.searchParams.set("text", tweetText());
    intent.searchParams.set("url", url());
    window.open(intent.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex items-center gap-1.5">
      {/* A detection is an editable draft, so a share/copy arms on the first
          click; this neutral nudge (site DA, not a warning colour) asks for the
          confirming re-click. `role="status"` makes it the armed state's
          announcement too, so neither button has to rename itself. */}
      {armed && (
        <span role="status" className="text-[10px] text-neutral-400">
          Detected and may still change. Click again to{" "}
          {armed === "copy" ? "copy" : "share"}.
        </span>
      )}
      <CopyButton
        value={url}
        label="Copy link"
        beforeCopy={onCopy}
        className={armed === "copy" ? "bg-neutral-800 ring-1 ring-neutral-500" : ""}
        title={armed === "copy" ? "Click again to copy this draft link" : undefined}
      />
      <Button
        icon
        variant="ghost"
        onClick={onShareX}
        className={armed === "share" ? "bg-neutral-800 ring-1 ring-neutral-500" : ""}
        aria-label="Share on X"
        title={armed === "share" ? "Click again to share this draft" : "Share on X"}
      >
        <XGlyph size={14} />
      </Button>
    </div>
  );
}

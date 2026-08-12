"use client";

import { Check, Copy } from "lucide-react";
import { formatDate } from "@/lib/format";
import type { EventStatus } from "@/types";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { Button } from "@/components/ui/Button";
import { XGlyph } from "@/components/ui/BrandGlyphs";

// How long an armed share / copy waits for its confirming re-click.
const ARM_MS = 3000;

interface ShareButtonsProps {
  id: string;
  title: string;
  author: string;
  /** Nullable: a coordless event (a ``requested`` row) has no date/coords line. */
  eventDate: string | null;
  lat: number | null;
  lng: number | null;
  /** A `detected` row is a machine draft its owner can still edit, so a shared
   *  link's content may change — surfaced as a caveat next to the share row. */
  status: EventStatus;
}

export default function ShareButtons({
  id,
  title,
  author,
  eventDate,
  lat,
  lng,
  status,
}: ShareButtonsProps) {
  const { copied, copy } = useCopyToClipboard();

  // window is undefined during SSR; the function shape keeps this safe to call
  // from any render-time path even though handlers only fire in the browser.
  const url = () =>
    typeof window === "undefined"
      ? `/events/${id}`
      : `${window.location.origin}/events/${id}`;

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

  // A `detected` link points at an editable draft, so sharing it asks for a
  // confirming re-click first (mirrors the review queue's two-click delete),
  // via the shared two-click confirm. Each action arms independently, so
  // arming one disarms the other: the nudge below names a single pending
  // action, and re-clicking the *other* button must not fire it outright.
  const copyConfirm = useConfirmAction(() => copy(url()), { timeoutMs: ARM_MS });
  const shareConfirm = useConfirmAction(openIntent, { timeoutMs: ARM_MS });

  // A submitted link acts on the first click; a detected one arms first, then acts.
  const needsConfirm = status === "detected";
  const armed: null | "copy" | "share" = copyConfirm.armed
    ? "copy"
    : shareConfirm.armed
      ? "share"
      : null;

  const onCopy = () => {
    if (!needsConfirm) {
      void copy(url());
      return;
    }
    shareConfirm.cancel();
    copyConfirm.trigger();
  };

  const onShareX = () => {
    if (!needsConfirm) {
      openIntent();
      return;
    }
    copyConfirm.cancel();
    shareConfirm.trigger();
  };

  return (
    <div className="flex items-center gap-1.5">
      {/* A detection is an editable draft, so a share/copy arms on the first
          click; this neutral nudge (site DA, not a warning colour) asks for the
          confirming re-click. */}
      {armed && (
        <span className="text-[10px] text-neutral-400">
          Detected and may still change. Click again to{" "}
          {armed === "copy" ? "copy" : "share"}.
        </span>
      )}
      <Button
        icon
        variant="ghost"
        onClick={onCopy}
        className={armed === "copy" ? "bg-neutral-800 ring-1 ring-neutral-500" : ""}
        title={
          armed === "copy"
            ? "Click again to copy this draft link"
            : copied
              ? "Link copied"
              : "Copy link"
        }
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {/* sr-only name + aria-live: a bare icon needs an accessible label, and
            a label change isn't announced reliably without the live region. */}
        <span className="sr-only" aria-live="polite">
          {copied
            ? "Link copied"
            : armed === "copy"
              ? "Click again to copy draft"
              : "Copy link"}
        </span>
      </Button>
      <Button
        icon
        variant="ghost"
        onClick={onShareX}
        className={armed === "share" ? "bg-neutral-800 ring-1 ring-neutral-500" : ""}
        title={armed === "share" ? "Click again to share this draft" : "Share on X"}
      >
        <XGlyph size={14} />
        <span className="sr-only">
          {armed === "share" ? "Click again to share draft" : "Share on X"}
        </span>
      </Button>
    </div>
  );
}

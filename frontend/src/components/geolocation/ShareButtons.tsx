"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { formatDate } from "@/lib/format";
import type { GeolocationState } from "@/types";

// Ghost orange, icon-only — mirrors the sidebar's icon shortcuts (square,
// hover-bg) so share reads as a light affordance, not a primary CTA competing
// with the content. The label lives in an sr-only span (+ a hover title), so
// the buttons stay compact without losing their accessible name.
const SHARE_BUTTON =
  "inline-flex items-center justify-center size-8 rounded-md text-orange-400 hover:text-orange-300 hover:bg-neutral-800 transition-colors";

interface ShareButtonsProps {
  id: string;
  title: string;
  author: string;
  eventDate: string;
  lat: number;
  lng: number;
  /** A `detected` row is a machine draft its owner can still edit, so a shared
   *  link's content may change — surfaced as a caveat next to the share row. */
  state: GeolocationState;
}

// Inline X logo — lucide doesn't ship one, and the legacy Twitter bird reads
// dated next to "Share on X". ~200B, so a dependency would be heavier.
function XLogo({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function ShareButtons({
  id,
  title,
  author,
  eventDate,
  lat,
  lng,
  state,
}: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  // A `detected` link points at an editable draft, so sharing it asks for a
  // confirming re-click first (mirrors the review queue's two-click delete).
  // `armed` is which action is awaiting that re-click; it auto-disarms.
  const [armed, setArmed] = useState<null | "copy" | "share">(null);
  // Tracked so a second click within the 1.5s window doesn't queue a duplicate
  // timer (flipping "Link copied" back early), and unmount clears it.
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      if (armResetTimer.current) clearTimeout(armResetTimer.current);
    };
  }, []);

  // Validated links act on the first click; a draft arms first, then acts.
  const needsConfirm = state === "detected";
  const arm = (which: "copy" | "share") => {
    setArmed(which);
    if (armResetTimer.current) clearTimeout(armResetTimer.current);
    armResetTimer.current = setTimeout(() => setArmed(null), 3000);
  };
  const disarm = () => {
    setArmed(null);
    if (armResetTimer.current) clearTimeout(armResetTimer.current);
  };

  // window is undefined during SSR; the function shape keeps this safe to call
  // from any render-time path even though handlers only fire in the browser.
  const url = () =>
    typeof window === "undefined"
      ? `/geolocations/${id}`
      : `${window.location.origin}/geolocations/${id}`;

  const tweetText = () =>
    [
      title,
      `by ${author} · ${formatDate(eventDate)}`,
      `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    ].join("\n");

  const onCopy = async () => {
    if (needsConfirm && armed !== "copy") {
      arm("copy");
      return;
    }
    disarm();
    try {
      await navigator.clipboard.writeText(url());
      setCopied(true);
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API fails on insecure contexts (http://, embedded webviews).
      // Silent no-op — the URL is still in the address bar.
    }
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
          confirming re-click. */}
      {armed && (
        <span className="text-[10px] text-neutral-400">
          Detected and may still change. Click again to{" "}
          {armed === "copy" ? "copy" : "share"}.
        </span>
      )}
      <button
        type="button"
        onClick={onCopy}
        className={`${SHARE_BUTTON}${armed === "copy" ? " bg-neutral-800 ring-1 ring-neutral-500" : ""}`}
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
      </button>
      <button
        type="button"
        onClick={onShareX}
        className={`${SHARE_BUTTON}${armed === "share" ? " bg-neutral-800 ring-1 ring-neutral-500" : ""}`}
        title={armed === "share" ? "Click again to share this draft" : "Share on X"}
      >
        <XLogo size={14} />
        <span className="sr-only">
          {armed === "share" ? "Click again to share draft" : "Share on X"}
        </span>
      </button>
    </div>
  );
}

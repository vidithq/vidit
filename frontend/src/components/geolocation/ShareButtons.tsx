"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { formatDate } from "@/lib/format";

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
}: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  // Tracked so a second click within the 1.5s window doesn't queue a duplicate
  // timer (flipping "Link copied" back early), and unmount clears it.
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    };
  }, []);

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
    // twitter.com/intent/tweet still serves the composer post-rebrand and is
    // the documented domain, so it won't be redirected away.
    const intent = new URL("https://twitter.com/intent/tweet");
    intent.searchParams.set("text", tweetText());
    intent.searchParams.set("url", url());
    window.open(intent.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onCopy}
        className={SHARE_BUTTON}
        title={copied ? "Link copied" : "Copy link"}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {/* sr-only name + aria-live: a bare icon needs an accessible label, and
            a label change isn't announced reliably without the live region. */}
        <span className="sr-only" aria-live="polite">
          {copied ? "Link copied" : "Copy link"}
        </span>
      </button>
      <button type="button" onClick={onShareX} className={SHARE_BUTTON} title="Share on X">
        <XLogo size={14} />
        <span className="sr-only">Share on X</span>
      </button>
    </div>
  );
}

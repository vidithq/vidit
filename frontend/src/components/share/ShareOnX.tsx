"use client";

import { Button } from "@/components/ui/Button";
import { XGlyph } from "@/components/ui/BrandGlyphs";

/**
 * Passing a record on: the X intent, prefilled with `lines` as the tweet body and the page at
 * `path` on this origin as its url. A getter, not a value: it reads `window` and runs only from a
 * click handler.
 */
export function shareIntentUrl(path: string, lines: string[]): string {
  // twitter.com/intent/tweet still serves the composer post-rebrand and is the documented domain.
  const intent = new URL("https://twitter.com/intent/tweet");
  intent.searchParams.set("text", lines.join("\n"));
  intent.searchParams.set("url", `${window.location.origin}${path}`);
  return intent.toString();
}

/** Opens the composer built by `shareIntentUrl`. */
export function openShareIntent(path: string, lines: string[]): void {
  window.open(shareIntentUrl(path, lines), "_blank", "noopener,noreferrer");
}

interface ShareOnXProps {
  /** The record's own page, e.g. `/events/{id}` or `/collections/{id}`. */
  path: string;
  /** The tweet body, one line per entry. */
  lines: string[];
  /** Overrides the default click (opening the intent). An event's `detected` row arms a confirm
   * here, so sharing content that may still change takes a second click. */
  onClick?: () => void;
  className?: string;
  title?: string;
}

/** The ghost icon control every share surface opens the X composer with: one shape and aria-label,
 * so it can't drift between callers. */
export default function ShareOnX({
  path,
  lines,
  onClick,
  className,
  title = "Share on X",
}: ShareOnXProps) {
  return (
    <Button
      icon
      variant="ghost"
      onClick={onClick ?? (() => openShareIntent(path, lines))}
      className={className}
      aria-label="Share on X"
      title={title}
    >
      <XGlyph size={14} />
    </Button>
  );
}

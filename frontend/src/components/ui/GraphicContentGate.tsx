"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { EyeOff } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { WARNING_CALLOUT } from "@/components/ui/styles";

/**
 * The age gate over media an author flagged as graphic (`events.is_graphic`).
 * The children render blurred and inert behind an interstitial asking the reader
 * to confirm they are 18 or older. Confirming once reveals every gated instance
 * for the rest of the browser session.
 *
 * - `full`: the detail surfaces (`MediaGallery`, the map side panel), with room
 *   for the whole sentence.
 * - `compact`: card-sized slots (`MediaThumb`, the map pin preview, a proof
 *   body's inline images), where the overlay is one labelled control.
 *
 * The acknowledgement lives in `sessionStorage` (survives a reload, dies with
 * the tab). A `storage` event does not fire in the writing tab, so the
 * subscriber set below unblurs every mounted gate at once. `memoryAck` covers a
 * browser that refuses storage (Safari private mode throws on write).
 */

const ACK_KEY = "vidit_graphic_ack";

// Used only when `sessionStorage` is unreachable.
let memoryAck = false;

const listeners = new Set<() => void>();

function isAcknowledged(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(ACK_KEY) === "1";
  } catch {
    return memoryAck;
  }
}

// The server render stays blurred so hydration matches.
function serverSnapshot(): boolean {
  return false;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function acknowledge(): void {
  memoryAck = true;
  try {
    window.sessionStorage.setItem(ACK_KEY, "1");
  } catch {
    // Storage refused: the in-memory flag carries the reveal.
  }
  // Copied: a listener may unsubscribe during the walk.
  for (const notify of [...listeners]) notify();
}

export function GraphicContentGate({
  children,
  variant = "full",
}: {
  children: ReactNode;
  variant?: "full" | "compact";
}) {
  const revealed = useSyncExternalStore(subscribe, isAcknowledged, serverSnapshot);

  if (revealed) return <>{children}</>;

  const compact = variant === "compact";
  // `compact` hosts are fixed-ratio slots whose child sizes against them, so the
  // gate's wrappers must pass the height through.
  return (
    <div className={cn("relative overflow-hidden rounded-lg", compact && "size-full")}>
      {/* Blurred and inert: the media keeps its layout but takes no clicks. `inert`
          (not `pointer-events-none`) also removes tab stops, so Tab and Enter
          cannot open the `MediaLightbox` trigger behind the gate. */}
      <div
        inert
        aria-hidden="true"
        className={cn(
          "pointer-events-none select-none blur-xl",
          compact && "size-full",
        )}
      >
        {children}
      </div>
      {compact ? (
        // One control filling the tile (no room for a sentence plus a button).
        // `z-20` outranks an `EntityCard`'s stretched link (`z-10`), which would
        // otherwise take the click and navigate.
        <Button
          variant="ghost"
          onClick={acknowledge}
          aria-label="Show graphic content (18 or older)"
          className={`absolute inset-0 z-20 h-full w-full flex-col gap-1 rounded-none px-1 ${WARNING_CALLOUT}`}
        >
          <EyeOff size={12} />
          <span className="text-[10px] leading-none">Graphic content</span>
        </Button>
      ) : (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg p-4 text-center ${WARNING_CALLOUT}`}
        >
          <EyeOff size={18} />
          <p className="max-w-sm text-sm leading-relaxed">
            The author flagged this footage as graphic: it can show death,
            injury or human remains. Confirm you are 18 or older to view it.
          </p>
          <Button
            variant="secondary"
            onClick={acknowledge}
            aria-label="Show graphic content (18 or older)"
          >
            I am 18 or older, show it
          </Button>
        </div>
      )}
    </div>
  );
}

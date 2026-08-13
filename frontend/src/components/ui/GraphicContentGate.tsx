"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { EyeOff } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { WARNING_CALLOUT } from "@/components/ui/styles";

/**
 * The age gate over media an author flagged as graphic (`events.is_graphic`).
 * Wraps the media it covers: the children render blurred and inert behind an
 * interstitial that names what is underneath and asks the reader to confirm
 * they are 18 or older. Confirming once reveals every gated instance for the
 * rest of the browser session.
 *
 * Two variants, one component:
 *
 * - `full`: the detail surfaces (`MediaGallery` on the event page and the map
 *   side panel), where there is room for the whole sentence.
 * - `compact`: the card-sized slots (`MediaThumb` on every catalogue card and
 *   the map pin preview, a proof body's inline images), where the tile is
 *   ~63px tall and the overlay is one labelled control filling it.
 *
 * The acknowledgement lives in `sessionStorage`, so it survives a reload and
 * dies with the tab. A `storage` event does not fire in the tab that wrote the
 * key, so same-tab instances would not learn about each other through it: the
 * subscriber set below is what makes one confirmation unblur every mounted
 * gate at once. `memoryAck` covers a browser that refuses storage entirely
 * (Safari's private mode throws on write), where the reveal then lasts as long
 * as the page.
 */

const ACK_KEY = "vidit_graphic_ack";

// The reveal state when `sessionStorage` is unreachable. Never consulted while
// storage works, so clearing the key is a full reset.
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

// Nothing is revealed in the server render: the reader has not answered yet,
// and the blurred markup is what must reach the browser for hydration to match.
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
    // Storage refused (private mode, blocked cookies): the in-memory flag above
    // still carries the reveal for this page.
  }
  // Copied first: a listener may unsubscribe while the set is being walked.
  for (const notify of [...listeners]) notify();
}

export function GraphicContentGate({
  children,
  variant = "full",
}: {
  /** The media the gate covers. */
  children: ReactNode;
  variant?: "full" | "compact";
}) {
  const revealed = useSyncExternalStore(subscribe, isAcknowledged, serverSnapshot);

  if (revealed) return <>{children}</>;

  const compact = variant === "compact";
  // `compact` hosts are fixed-ratio slots whose child sizes itself against
  // them (`MediaThumb`'s `h-full` picture), so the two wrappers the gate adds
  // must pass that height straight through instead of collapsing to auto.
  return (
    <div className={cn("relative overflow-hidden rounded-lg", compact && "size-full")}>
      {/* Blurred and inert: the covered media stays in the layout (the block
          keeps its size) but takes no clicks and no tab stops, so a reader
          cannot open the lightbox behind the gate. `inert` is what removes the
          tab stops: `pointer-events-none` only stops the pointer, and a
          focusable child (`MediaLightbox`'s trigger) was still reachable with
          Tab and openable with Enter, at full size and ungated. */}
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
        // One control filling the tile: at card size there is no room for a
        // sentence plus a separate button.
        //
        // `z-20` is the lift every interactive child of an `EntityCard` gets
        // (see `AuthorLink`, `relative z-20`): the card's stretched link is
        // `absolute inset-0 z-10`, so without it a click on this control hit
        // the link and navigated to the event instead of revealing the media.
        // Outside a card there is nothing to outrank and it changes nothing.
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

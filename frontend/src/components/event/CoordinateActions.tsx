"use client";

import { ExternalLink } from "lucide-react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { formatCoordinates, mapsUrl } from "@/lib/coordinates";

/**
 * The two things anyone does with a coordinate pair: check it against
 * satellite imagery, or take it away. One home and one shape, so the entry
 * control (`CoordinateInputs`, in the third column of every latitude /
 * longitude row) and the event detail page's coordinates row can't drift apart.
 * What lands on the clipboard is the same 6-decimal rendering the page shows,
 * which pastes back into the inputs as a pair.
 *
 * Two square ghost icon buttons, the shape that fits beside a field without
 * taking width from it. The map link is named by its `aria-label` and its
 * tooltip, so *View on Maps* is what a reader hears and what a pointer reveals.
 *
 * A null pair (a coordinate still being typed, or one out of bounds) renders
 * both controls disabled rather than removing them: the actions occupy the same
 * width whether or not they can act, so the row they sit in never jumps, and a
 * greyed control says the point is not usable yet where a vanished one says
 * nothing at all.
 */
export function CoordinateActions({
  lat,
  lng,
}: {
  /** Null while the pair is half-typed or out of bounds: both controls grey. */
  lat: number | null;
  lng: number | null;
}) {
  const disabled = lat === null || lng === null;

  return (
    <span className="inline-flex items-center gap-1">
      {disabled ? (
        // A real disabled button, not a greyed anchor: it carries the primitive's
        // disabled styling, leaves the tab order, and has nowhere to navigate.
        <Button icon variant="ghost" disabled aria-label="View on Maps">
          <ExternalLink size={15} />
        </Button>
      ) : (
        <a
          href={mapsUrl(lat, lng)}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses("ghost", { icon: true })}
          aria-label="View on Maps"
          title="View on Maps"
        >
          <ExternalLink size={15} />
        </a>
      )}
      <CopyButton
        // Re-checked inside the getter rather than falling back to a made-up
        // point: a disabled button never reaches the write, and nothing here
        // should be able to put a coordinate nobody typed on the clipboard.
        value={() =>
          lat === null || lng === null ? "" : formatCoordinates(lat, lng)
        }
        label="Copy coordinates"
        copiedLabel="Coordinates copied"
        disabled={disabled}
      />
    </span>
  );
}

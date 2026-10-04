"use client";

import { Check, Copy, ExternalLink } from "lucide-react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { formatCoordinates, mapsUrl } from "@/lib/coordinates";

/** What the map control says while the pair cannot be opened (its name carries the state; the mark only says "maps"). */
const NO_MAP_LINK = "No map link until the coordinate pair is complete";
const MAP_LINK = "View on Maps";

/**
 * The two things anyone does with a coordinate pair: check it against satellite imagery, or take
 * it away. One home so `CoordinateInputs` (the longitude field's trailing adornment) and the event
 * page's coordinates row can't drift. The clipboard gets the page's 6-decimal rendering, which
 * pastes back into the inputs as a pair.
 *
 * Two ghost icon buttons, the site's one icon control, a hair apart so the hover plates read as
 * two controls.
 *
 * A null pair (half-typed or out of bounds) keeps both controls in place and disabled, so the
 * field never jumps and grey says the point isn't usable yet. The map link becomes a button then:
 * a disabled anchor isn't a thing.
 */
export function CoordinateActions({
  lat,
  lng,
}: {
  /** Null while the pair is half-typed or out of bounds: both controls grey. */
  lat: number | null;
  lng: number | null;
}) {
  const point = lat === null || lng === null ? null : { lat, lng };

  return (
    <span className="inline-flex items-center gap-0.5">
      {point ? (
        <a
          href={mapsUrl(point.lat, point.lng)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={MAP_LINK}
          title={MAP_LINK}
          className={buttonClasses("ghost", { icon: true })}
        >
          <ExternalLink size={14} />
        </a>
      ) : (
        <Button icon variant="ghost" disabled aria-label={NO_MAP_LINK} title={NO_MAP_LINK}>
          <ExternalLink size={14} />
        </Button>
      )}
      <CopyCoordinates point={point} />
    </span>
  );
}

/**
 * The pair on the clipboard, in the one icon-control shape. `useCopyToClipboard` owns the write
 * and flash timer, worn in whatever shape the surroundings need (the profile's Discord account,
 * the admin invite row). No shape may differ on accessibility: the name is static (a name that
 * changes on click is re-announced as a new control) and the confirmation lands in a sibling live
 * region. Only the tooltip and mark flip.
 */
function CopyCoordinates({ point }: { point: { lat: number; lng: number } | null }) {
  const { copied, copy } = useCopyToClipboard();
  const label = "Copy coordinates";
  const copiedLabel = "Coordinates copied";

  return (
    <>
      <Button
        icon
        variant="ghost"
        // Nothing to write while the pair is incomplete: the control is grey and inert.
        disabled={point === null}
        aria-label={label}
        title={copied ? copiedLabel : label}
        onClick={() => {
          if (point) void copy(formatCoordinates(point.lat, point.lng));
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
      {/* Sibling, not the button's name: as the name it would re-announce the control on every flip. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}

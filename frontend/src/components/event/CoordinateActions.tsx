"use client";

import { Check, Copy, ExternalLink } from "lucide-react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { formatCoordinates, mapsUrl } from "@/lib/coordinates";

/** What the map control says while the pair cannot be opened. Its name carries
 *  the state, since the mark itself only says "maps". */
const NO_MAP_LINK = "No map link until the coordinate pair is complete";
const MAP_LINK = "View on Maps";

/**
 * The two things anyone does with a coordinate pair: check it against
 * satellite imagery, or take it away. One home and one shape, so the entry
 * control (`CoordinateInputs`, where it is the longitude field's trailing
 * adornment) and the event detail page's coordinates row can't drift apart.
 * What lands on the clipboard is the same 6-decimal rendering the page shows,
 * which pastes back into the inputs as a pair.
 *
 * Two ghost icon buttons, the one icon control on the site: the same square and
 * the same hover plate the share row and the page-header clusters carry, so a
 * control reads the same wherever it sits. They sit a hair apart, so the two
 * hover plates read as two controls rather than as one wide one.
 *
 * A null pair (a coordinate still being typed, or one out of bounds) keeps both
 * controls in place and disabled rather than removing them: they occupy the same
 * width whether or not they can act, so the field they sit in never jumps, and a
 * grey control says the point is not usable yet where a vanished one says
 * nothing at all. `disabled` is what paints them grey, the same neutral every
 * refusing control on the site wears, and the map link becomes a button in that
 * state: there is nothing to navigate to, and a disabled anchor is not a thing.
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
 * The pair on the clipboard, in the one icon-control shape.
 *
 * `useCopyToClipboard` owns the write and the flash timer, so every copy
 * gesture on the site is this one hook worn in whatever shape its surroundings
 * call for (the profile's Discord account is the same icon button; the admin
 * invite row is a text button). What no shape may differ on is the
 * accessibility of the flash: the name is static, because a name that changes
 * on click is re-announced as a new control, and the confirmation lands in a
 * sibling live region instead. Only the tooltip and the mark itself flip.
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
        // Nothing to write while the pair is incomplete, and a control that
        // cannot act is grey and inert rather than a button that copies a
        // coordinate nobody typed.
        disabled={point === null}
        aria-label={label}
        title={copied ? copiedLabel : label}
        onClick={() => {
          if (point) void copy(formatCoordinates(point.lat, point.lng));
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
      {/* Sibling, not the button's own name: as the name it would re-announce
          the control on every flip instead of reporting a status. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}

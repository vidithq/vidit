"use client";

import { Copy, ExternalLink } from "lucide-react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { Tooltip } from "@/components/ui/Tooltip";
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
        <Tooltip label={MAP_LINK}>
          <OutboundLink
            href={mapsUrl(point.lat, point.lng)}
            aria-label={MAP_LINK}
            className={buttonClasses("ghost", { icon: true })}
          >
            <ExternalLink size={14} />
          </OutboundLink>
        </Tooltip>
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
 * A detail row's coordinate value: the pair, then its two actions. The group is wider than a
 * narrow phone row, so it wraps the actions onto a second line instead of pushing the page
 * sideways; `min-w-0` lets it shrink so the wrap happens, and `justify-end` keeps the wrapped
 * line flush right.
 */
export function CoordinateValue({ lat, lng }: { lat: number; lng: number }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <span className="font-mono text-sm text-neutral-200">{formatCoordinates(lat, lng)}</span>
      <CoordinateActions lat={lat} lng={lng} />
    </span>
  );
}

/** The pair on the clipboard, confirmed by `CopyButton`, the app's one copy confirmation. */
function CopyCoordinates({ point }: { point: { lat: number; lng: number } | null }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <CopyButton
      label="Copy coordinates"
      announce="Coordinates copied"
      icon={<Copy size={14} />}
      copied={copied}
      // Nothing to write while the pair is incomplete: the control is grey and inert.
      disabled={point === null}
      onClick={() => {
        if (point) void copy(formatCoordinates(point.lat, point.lng));
      }}
    />
  );
}

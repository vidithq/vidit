"use client";

import { Copy, ExternalLink } from "lucide-react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { Tooltip } from "@/components/ui/Tooltip";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { cn } from "@/lib/cn";
import { formatCoordinates, mapsUrl } from "@/lib/coordinates";

/** What the map control says while the pair cannot be opened (its name carries the state; the mark only says "maps"). */
const NO_MAP_LINK = "No map link until the coordinate pair is complete";
const MAP_LINK = "View on Maps";
const SMALL_SHAPE = "sm:size-6";

/**
 * The two things anyone does with a coordinate pair: check it against satellite imagery, or take
 * it away. One home so `CoordinateInputs` (after its two fields) and the event page's coordinates
 * row can't drift. The clipboard gets the page's 6-decimal rendering, which pastes back into the
 * inputs as a pair.
 *
 * Two outlined icon buttons, each its own box, the look of an action that stands beside a field on
 * the same line.
 *
 * A null pair (half-typed or out of bounds) keeps both controls in place and disabled, so the
 * line never jumps and grey says the point isn't usable yet. The map link becomes a button then:
 * a disabled anchor isn't a thing.
 *
 * `small` is the 24px desktop square (the phone keeps its tap floor), for a dense row. Its
 * negative margin keeps the square from growing the line.
 */
export function CoordinateActions({
  lat,
  lng,
  small = false,
}: {
  /** Null while the pair is half-typed or out of bounds: both controls grey. */
  lat: number | null;
  lng: number | null;
  small?: boolean;
}) {
  const point = lat === null || lng === null ? null : { lat, lng };
  const shape = small ? SMALL_SHAPE : "";
  const mark = small ? 12 : 14;

  return (
    <span className={cn("inline-flex items-center gap-1", small && "-my-1.5")}>
      {point ? (
        <Tooltip label={MAP_LINK}>
          <OutboundLink
            href={mapsUrl(point.lat, point.lng)}
            aria-label={MAP_LINK}
            className={buttonClasses("secondary", { icon: true, className: shape })}
          >
            <ExternalLink size={mark} />
          </OutboundLink>
        </Tooltip>
      ) : (
        <Button
          icon
          variant="secondary"
          disabled
          aria-label={NO_MAP_LINK}
          title={NO_MAP_LINK}
          className={shape}
        >
          <ExternalLink size={mark} />
        </Button>
      )}
      <CopyCoordinates point={point} className={shape} mark={mark} />
    </span>
  );
}

/**
 * A detail row's coordinate value: the pair, then its two actions. The group is wider than a
 * narrow phone row, so it wraps the actions onto a second line instead of pushing the page
 * sideways; `min-w-0` lets it shrink so the wrap happens, and `justify-end` keeps the wrapped
 * line flush right.
 *
 * `compact` fits a narrow card on one line that never wraps: the pair at 4 decimals in small
 * text, then the `small` actions. The copy still carries 6 decimals.
 */
export function CoordinateValue({
  lat,
  lng,
  compact = false,
}: {
  lat: number;
  lng: number;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center justify-end",
        compact ? "ml-auto shrink-0 gap-x-1 whitespace-nowrap" : "min-w-0 flex-wrap gap-x-2 gap-y-1",
      )}
    >
      <span className={cn("font-mono text-neutral-200", compact ? "text-xs" : "text-sm")}>
        {formatCoordinates(lat, lng, compact ? 4 : 6)}
      </span>
      <CoordinateActions lat={lat} lng={lng} small={compact} />
    </span>
  );
}

/** The pair on the clipboard, confirmed by `CopyButton`, the app's one copy confirmation. */
function CopyCoordinates({
  point,
  className,
  mark,
}: {
  point: { lat: number; lng: number } | null;
  className: string;
  mark: number;
}) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <CopyButton
      label="Copy coordinates"
      announce="Coordinates copied"
      icon={<Copy size={mark} />}
      variant="secondary"
      className={className}
      copied={copied}
      // Nothing to write while the pair is incomplete: the control is grey and inert.
      disabled={point === null}
      onClick={() => {
        if (point) void copy(formatCoordinates(point.lat, point.lng));
      }}
    />
  );
}

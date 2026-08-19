"use client";

import { Check, Copy, ExternalLink } from "lucide-react";

import { Glyph } from "@/components/ui/Glyph";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { formatCoordinates, mapsUrl } from "@/lib/coordinates";

/**
 * The two things anyone does with a coordinate pair: check it against
 * satellite imagery, or take it away. One home and one shape, so the entry
 * control (`CoordinateInputs`, in the third column of every latitude /
 * longitude row) and the event detail page's coordinates row can't drift apart.
 * What lands on the clipboard is the same 6-decimal rendering the page shows,
 * which pastes back into the inputs as a pair.
 *
 * Two `<Glyph>` marks, the shape the archived-copy mark carries beside a source
 * link: 13px, set in the line they act on, with no button box to outweigh the
 * coordinate itself or to take width from the fields they sit beside.
 *
 * A null pair (a coordinate still being typed, or one out of bounds) keeps both
 * marks in place and grey rather than removing them: the actions occupy the
 * same width whether or not they can act, so the row they sit in never jumps,
 * and a grey mark says the point is not usable yet where a vanished one says
 * nothing at all. Grey is the state itself, not a dimmed accent, and the marks
 * are inert while they wear it: `<Glyph active={false}>` neither navigates nor
 * fires whatever it was handed.
 */
export function CoordinateActions({
  lat,
  lng,
}: {
  /** Null while the pair is half-typed or out of bounds: both marks grey. */
  lat: number | null;
  lng: number | null;
}) {
  const point = lat === null || lng === null ? null : { lat, lng };

  return (
    <span className="inline-flex items-center gap-1.5">
      <Glyph
        icon={ExternalLink}
        label={
          point
            ? "View on Maps"
            : "No map link until the coordinate pair is complete"
        }
        href={point ? mapsUrl(point.lat, point.lng) : undefined}
        active={point !== null}
      />
      <CopyCoordinates point={point} />
    </span>
  );
}

/**
 * The pair on the clipboard, in the glyph shape.
 *
 * `useCopyToClipboard` owns the write and the flash timer, so every copy
 * gesture on the site is this one hook worn in whatever shape its surroundings
 * call for (the profile's Discord account is the same glyph shape; the admin
 * invite row is a text button). What no shape may differ on is the
 * accessibility of the flash: the name is static, because a name that changes
 * on click is re-announced as a new control, and the confirmation lands in a
 * sibling live region instead. Only the tooltip and the mark itself flip.
 */
function CopyCoordinates({ point }: { point: { lat: number; lng: number } | null }) {
  const { copied, copy } = useCopyToClipboard();
  const copiedLabel = "Coordinates copied";

  return (
    <>
      <Glyph
        icon={copied ? Check : Copy}
        label="Copy coordinates"
        title={copied ? copiedLabel : "Copy coordinates"}
        // Re-checked inside the handler rather than falling back to a made-up
        // point: an inactive glyph never fires, and nothing here should be able
        // to put a coordinate nobody typed on the clipboard.
        onClick={() => {
          if (point) void copy(formatCoordinates(point.lat, point.lng));
        }}
        active={point !== null}
      />
      {/* Sibling, not the glyph's own name: as the name it would re-announce
          the control on every flip instead of reporting a status. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}

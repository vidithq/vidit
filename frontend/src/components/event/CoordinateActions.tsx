"use client";

import { ExternalLink } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { TEXT_LINK } from "@/components/ui/styles";
import { formatCoordinates, mapsUrl } from "@/lib/coordinates";

/**
 * The two things anyone does with a coordinate pair: check it against
 * satellite imagery, or take it away. One home, so the entry control
 * (`CoordinateInputs`, beside every latitude / longitude pair once it parses in
 * bounds) and the event detail page's coordinates row can't drift apart. What
 * lands on the clipboard is the same 6-decimal rendering the page shows, which
 * pastes back into the inputs as a pair.
 *
 * `compact` picks the shape for the form's input row, where the pair sits in a
 * third grid column and a text link would widen the cell at the expense of the
 * fields: both halves become square ghost icon buttons, the same size the copy
 * already is. The event page's coordinates row keeps the text link, since it
 * reads as part of a sentence rather than as a control beside a field. The
 * accessible name is *View on Maps* either way.
 */
export function CoordinateActions({
  lat,
  lng,
  compact = false,
}: {
  lat: number;
  lng: number;
  /** Icon-only shape, for the coordinate input row. */
  compact?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={mapsUrl(lat, lng)}
        target="_blank"
        rel="noopener noreferrer"
        className={
          compact
            ? buttonClasses("ghost", { icon: true })
            : `${TEXT_LINK} inline-flex items-center gap-1 text-xs`
        }
        aria-label={compact ? "View on Maps" : undefined}
        title={compact ? "View on Maps" : undefined}
      >
        {!compact && "View on Maps"}
        <ExternalLink size={compact ? 15 : 11} />
      </a>
      <CopyButton
        value={() => formatCoordinates(lat, lng)}
        label="Copy coordinates"
        copiedLabel="Coordinates copied"
      />
    </span>
  );
}

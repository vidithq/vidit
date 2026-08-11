"use client";

import { ExternalLink } from "lucide-react";

import { CopyButton } from "@/components/ui/CopyButton";
import { TEXT_LINK } from "@/components/ui/styles";
import { formatCoordinates, mapsUrl } from "@/lib/coordinates";

/**
 * The two things anyone does with a coordinate pair: check it against
 * satellite imagery, or take it away. One home, so the entry control
 * (`CoordinateInputs`, under every latitude / longitude pair once it parses in
 * bounds) and the event detail page's coordinates row can't drift apart. What
 * lands on the clipboard is the same 6-decimal rendering the page shows, which
 * pastes back into the inputs as a pair.
 */
export function CoordinateActions({ lat, lng }: { lat: number; lng: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={mapsUrl(lat, lng)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${TEXT_LINK} inline-flex items-center gap-1 text-xs`}
      >
        View on Maps
        <ExternalLink size={11} />
      </a>
      <CopyButton
        value={() => formatCoordinates(lat, lng)}
        label="Copy coordinates"
        copiedLabel="Coordinates copied"
      />
    </span>
  );
}

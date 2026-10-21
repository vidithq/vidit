"use client";

import dynamic from "next/dynamic";
import { Check, Eraser, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";
import type { DrawState } from "@/components/map/ZoneDrawMap";
import type { MapSite } from "@/components/map/SiteLayers";
import { MIN_ZONE_VERTICES, zoneAreaKm2, zoneSelfCrosses } from "@/lib/siteZone";
import type { MapBounds } from "@/lib/viewport";

const ZoneDrawMap = dynamic(() => import("@/components/map/ZoneDrawMap"), { ssr: false });

export const EMPTY_DRAW: DrawState = { vertices: [], closed: false };

/** True when the drawn ring is closed and its edges do not cross: the zone the API takes. */
export function drawReady(state: DrawState): boolean {
  return (
    state.closed && state.vertices.length >= MIN_ZONE_VERTICES && !zoneSelfCrosses(state.vertices)
  );
}

/**
 * The zone field of a site form: the draw canvas with its toolbar above and the zone's size
 * below, as one module like the event form's Location block.
 */
export function ZoneEditor({
  state,
  onChange,
  sites,
  bounds,
  center,
  onBoundsChange,
}: {
  state: DrawState;
  onChange: (next: DrawState) => void;
  sites: MapSite[];
  bounds?: MapBounds;
  center?: { lat: number; lng: number; zoom: number };
  onBoundsChange?: (bounds: MapBounds) => void;
}) {
  const { vertices, closed } = state;
  const crosses = closed && zoneSelfCrosses(vertices);
  const hint = closed
    ? "Drag a corner to adjust the zone."
    : vertices.length >= MIN_ZONE_VERTICES
      ? "Click the first corner or Done to close the zone."
      : "Click on the map to add the corners of the zone.";

  return (
    <div className="rounded-lg border border-neutral-700">
      <div className="flex flex-wrap items-center gap-1.5 rounded-t-lg border-b border-neutral-800 bg-neutral-900 px-2 py-1.5">
        <Button
          variant="ghost"
          disabled={vertices.length === 0}
          onClick={() =>
            onChange(closed ? { vertices, closed: false } : { vertices: vertices.slice(0, -1), closed })
          }
        >
          <Undo2 size={14} />
          {closed ? "Reopen" : "Undo corner"}
        </Button>
        <Button
          variant="ghost"
          disabled={closed || vertices.length < MIN_ZONE_VERTICES}
          onClick={() => onChange({ vertices, closed: true })}
        >
          <Check size={14} />
          Done
        </Button>
        <Button variant="ghost" disabled={vertices.length === 0} onClick={() => onChange({ vertices: [], closed: false })}>
          <Eraser size={14} />
          Redraw
        </Button>
        <span className="ml-auto px-1 text-xs text-neutral-500">{hint}</span>
      </div>
      <div className="h-80 overflow-hidden">
        <ZoneDrawMap
          state={state}
          onChange={onChange}
          sites={sites}
          bounds={bounds}
          center={center}
          onBoundsChange={onBoundsChange}
        />
      </div>
      <DetailRow
        label="Zone"
        concept="site_zone"
        align="center"
        className="rounded-b-lg border-t border-neutral-800 bg-neutral-900"
      >
        <span className={crosses ? "text-sm text-red-400" : "text-sm text-neutral-200"}>
          {crosses
            ? "The edges cross: move a corner"
            : closed
              ? `${zoneAreaKm2(vertices).toFixed(2)} km² · ${vertices.length} corners`
              : `${vertices.length} corners, not closed`}
        </span>
      </DetailRow>
    </div>
  );
}

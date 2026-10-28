"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { Check, Eraser, Minus, RotateCcw, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DetailRow } from "@/components/ui/DetailRow";
import { GoToCoordinates } from "@/components/map/GoToCoordinates";
import type { DrawChange } from "@/components/map/ZoneDrawMap";
import { cn } from "@/lib/cn";
import type { CoordinatePair } from "@/lib/coordinates";
import {
  EMPTY_DRAW,
  MIN_ZONE_VERTICES,
  removeVertex,
  zoneAreaKm2,
  zoneSelfCrosses,
  type DrawState,
} from "@/lib/siteZone";
import type { Zone } from "@/lib/sites";
import type { MapBounds } from "@/lib/viewport";

const ZoneDrawMap = dynamic(() => import("@/components/map/ZoneDrawMap"), { ssr: false });

/** The steps **Undo** walks back. */
const UNDO_DEPTH = 50;

/** The editor's state with its undo stack: every change but a drag step is one step back. */
export function useDrawHistory(initial: DrawState) {
  const [{ state, past }, setHistory] = useState({ state: initial, past: [] as DrawState[] });
  const change: DrawChange = useCallback((next, transient = false) => {
    setHistory((h) => ({
      state: next,
      past: transient ? h.past : [...h.past.slice(-UNDO_DEPTH + 1), h.state],
    }));
  }, []);
  const undo = useCallback(() => {
    setHistory((h) => {
      const previous = h.past.at(-1);
      return previous ? { state: previous, past: h.past.slice(0, -1) } : h;
    });
  }, []);
  return { state, change, undo, canUndo: past.length > 0 };
}

function hint(state: DrawState): string {
  if (state.closed) {
    return state.selected === null
      ? "Drag a corner to move it, or drag a dot between two corners to add one."
      : "Drag the corner to move it, or remove it.";
  }
  if (state.vertices.length >= MIN_ZONE_VERTICES) return "Click the first corner or Close to finish.";
  return "Click on the map to place the corners of the contour.";
}

/**
 * The contour field of a site form: the draw canvas with its toolbar and the go-to-coordinates
 * field above and the contour's size below, one module like the event page's Location block. **Start over** clears the ring;
 * with a `reference` (the contour being redrawn), **Back to the current contour** restores it.
 */
export function ZoneEditor({
  history,
  reference = null,
  onReset,
  bounds,
  center,
  invalid = false,
  label,
}: {
  history: ReturnType<typeof useDrawHistory>;
  reference?: Zone | null;
  /** Restores the contour being redrawn. */
  onReset?: () => void;
  bounds?: MapBounds;
  center?: { lat: number; lng: number; zoom: number };
  /** A write attempt found no closed contour: the frame turns red. */
  invalid?: boolean;
  /** The region's accessible name. */
  label: string;
}) {
  const { state, change, undo, canUndo } = history;
  const [goTo, setGoTo] = useState<CoordinatePair | null>(null);
  const { vertices, closed, selected } = state;
  const crosses = closed && zoneSelfCrosses(vertices);
  const canRemove = selected !== null && (!closed || vertices.length > MIN_ZONE_VERTICES);

  return (
    <section
      aria-label={label}
      className={cn(
        "rounded-lg border",
        invalid || crosses ? "border-red-500/60" : "border-neutral-700",
      )}
    >
      <div
        role="toolbar"
        aria-label="Contour tools"
        className="flex flex-wrap items-center gap-1 rounded-t-lg border-b border-neutral-800 bg-neutral-900 px-2 py-1.5"
      >
        <Button variant="ghost" disabled={!canUndo} onClick={undo}>
          <Undo2 size={14} />
          Undo
        </Button>
        {closed ? (
          <Button
            variant="ghost"
            disabled={!canRemove}
            onClick={() => selected !== null && change(removeVertex(state, selected))}
          >
            <Minus size={14} />
            Remove corner
          </Button>
        ) : (
          <Button
            variant="ghost"
            disabled={vertices.length < MIN_ZONE_VERTICES}
            onClick={() => change({ ...state, closed: true, selected: null })}
          >
            <Check size={14} />
            Close
          </Button>
        )}
        <Button variant="ghost" disabled={vertices.length === 0} onClick={() => change(EMPTY_DRAW)}>
          <Eraser size={14} />
          Start over
        </Button>
        {onReset && (
          <Button variant="ghost" onClick={onReset}>
            <RotateCcw size={14} />
            Back to the current contour
          </Button>
        )}
      </div>
      <p className="border-b border-neutral-800 bg-neutral-900 px-4 py-2 text-xs text-neutral-400" aria-live="polite">
        {hint(state)}
      </p>
      <div className="border-b border-neutral-800 bg-neutral-900 px-4 py-2">
        {/* A new object per Go, so the same pair typed twice centres the map twice. */}
        <GoToCoordinates onGo={(pair) => setGoTo({ ...pair })} />
      </div>
      <div className="h-80 overflow-hidden sm:h-96">
        <ZoneDrawMap
          state={state}
          onChange={change}
          reference={reference}
          bounds={bounds}
          center={center}
          goTo={goTo}
        />
      </div>
      <DetailRow
        label="Contour"
        concept="site_zone"
        align="center"
        className="rounded-b-lg border-t border-neutral-800 bg-neutral-900"
      >
        <span
          className={cn("text-right text-sm", crosses || invalid ? "text-red-400" : "text-neutral-200")}
          role={crosses ? "alert" : undefined}
        >
          {crosses
            ? "Two edges cross. Move a corner."
            : closed
              ? `${zoneAreaKm2(vertices).toFixed(2)} km² · ${vertices.length} corners`
              : vertices.length === 0
                ? "Not drawn yet"
                : `${vertices.length} corners, not closed`}
        </span>
      </DetailRow>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

import type { MapPoint } from "@/types";
import { cn } from "@/lib/cn";
import { ICON_TAP_STEP } from "@/components/ui/Button";
import { FIELD_TEXT } from "@/components/ui/Input";

interface TimelineScrubberProps {
  /** Filtered point set (post conflict/tag/author, pre-window); drives the histogram and axis. */
  points: MapPoint[];
  /** Which date each point is bucketed/filtered on: 3 = event_date,
   *  4 = submitted (created_at) date. */
  dateIndex: 3 | 4;
  /** Short label for accessibility ("Event date" / "Added"). */
  label: string;
  /** The active window, owned by the parent. An empty string at an edge is open (snaps to data min/max). */
  start: string;
  setStart: (v: string) => void;
  end: string;
  setEnd: (v: string) => void;
  playing: boolean;
  setPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;
}

/** ISO `YYYY-MM-DD` to ms at UTC midnight (strings sort chronologically; positioning needs numbers). */
const toMs = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const msToIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const BIN_COUNT = 48;
const DAY_MS = 86_400_000;
// One bin advances per tick while playing: about 14 s for a full sweep.
const PLAY_INTERVAL_MS = 280;

/**
 * Reusable date-timeline filter. Two handles (and the date inputs) select a window, filtered
 * client-side so dragging and playback never refetch. Play sweeps the window's end across the axis.
 */
export function TimelineScrubber({
  points,
  dateIndex,
  label,
  start,
  setStart,
  end,
  setEnd,
  playing,
  setPlaying,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<null | "start" | "end">(null);

  const { dataMin, dataMax } = useMemo(() => {
    let lo: string | null = null;
    let hi: string | null = null;
    for (const p of points) {
      const d = p[dateIndex];
      if (!d) continue;
      if (lo === null || d < lo) lo = d;
      if (hi === null || d > hi) hi = d;
    }
    return { dataMin: lo, dataMax: hi };
  }, [points, dateIndex]);

  // An empty handle snaps to the axis edge.
  const winStart = start || dataMin || "";
  const winEnd = end || dataMax || "";

  const hasAxis = !!dataMin && !!dataMax;
  const axisMinMs = hasAxis ? toMs(dataMin as string) : 0;
  const axisMaxMs = hasAxis ? toMs(dataMax as string) : 0;
  const span = axisMaxMs - axisMinMs;

  const bins = useMemo(() => {
    const counts = new Array<number>(BIN_COUNT).fill(0);
    if (!hasAxis) return counts;
    for (const p of points) {
      const d = p[dateIndex];
      if (!d) continue;
      const t = toMs(d);
      if (t < axisMinMs || t > axisMaxMs) continue;
      const idx =
        span > 0 ? Math.min(BIN_COUNT - 1, Math.floor(((t - axisMinMs) / span) * BIN_COUNT)) : 0;
      counts[idx] += 1;
    }
    return counts;
  }, [points, dateIndex, hasAxis, axisMinMs, axisMaxMs, span]);

  const maxBin = Math.max(1, ...bins);
  const frac = (ms: number) => (span > 0 ? clamp01((ms - axisMinMs) / span) : 0);
  const startFrac = winStart ? frac(toMs(winStart)) : 0;
  const endFrac = winEnd ? frac(toMs(winEnd)) : 1;
  const winStartMs = winStart ? toMs(winStart) : axisMinMs;
  const winEndMs = winEnd ? toMs(winEnd) : axisMaxMs;

  const isWindowed = startFrac > 0.001 || endFrac < 0.999;

  // Latest `end` readable inside the play interval without re-subscribing the timer.
  const endRef = useRef(end);
  useEffect(() => {
    endRef.current = end;
  }, [end]);

  useEffect(() => {
    if (!playing || span <= 0) return;
    // Advance by whole days (min one) so a narrow span can't repeat an ISO day and stall. Anchor the
    // start at its value when play began.
    const step = Math.max(DAY_MS, Math.round(span / BIN_COUNT / DAY_MS) * DAY_MS);
    const anchorMs = winStart ? toMs(winStart) : axisMinMs;
    const id = setInterval(() => {
      const curEnd = endRef.current ? toMs(endRef.current) : axisMaxMs;
      // Clamp so the last frame shows the full range; loop only once the end reached the axis max.
      if (curEnd >= axisMaxMs) {
        setEnd(msToIso(Math.min(axisMaxMs, anchorMs + step)));
      } else {
        setEnd(msToIso(Math.min(axisMaxMs, curEnd + step)));
      }
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(id);
    // Re-subscribes if the start or axis changes; harmless, since a drag pauses play first.
  }, [playing, span, axisMaxMs, axisMinMs, winStart, setEnd]);

  const setHandle = (clientX: number, which: "start" | "end") => {
    const track = trackRef.current;
    if (!track || span <= 0) return;
    const rect = track.getBoundingClientRect();
    const f = clamp01((clientX - rect.left) / rect.width);
    const iso = msToIso(axisMinMs + f * span);
    if (which === "start") setStart(iso > winEnd ? winEnd : iso);
    else setEnd(iso < winStart ? winStart : iso);
  };

  // Capture on the stable *track*, not the handle: its `left` shifts mid-drag and can drop the
  // capture, leaving draggingRef set so the window chases a hover. Cleared on up, cancel, lost-capture.
  const beginDrag = (e: React.PointerEvent<HTMLDivElement>, which: "start" | "end") => {
    e.preventDefault();
    draggingRef.current = which;
    trackRef.current?.setPointerCapture(e.pointerId);
    if (playing) setPlaying(false);
  };
  const onTrackMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const which = draggingRef.current;
    if (which) setHandle(e.clientX, which);
  };
  const stopDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    if (trackRef.current?.hasPointerCapture(e.pointerId)) {
      trackRef.current.releasePointerCapture(e.pointerId);
    }
  };

  // Keyboard control (role="slider"): arrows nudge a day, PageUp/Down a bin, Home/End jump. Mirrors
  // the drag clamp and pauses playback.
  const nudgeHandle = (which: "start" | "end", deltaMs: number) => {
    const lo = winStart ? toMs(winStart) : axisMinMs;
    const hi = winEnd ? toMs(winEnd) : axisMaxMs;
    if (which === "start") setStart(msToIso(Math.min(hi, Math.max(axisMinMs, lo + deltaMs))));
    else setEnd(msToIso(Math.max(lo, Math.min(axisMaxMs, hi + deltaMs))));
  };
  const onHandleKey = (e: React.KeyboardEvent<HTMLDivElement>, which: "start" | "end") => {
    if (span <= 0) return;
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (playing) setPlaying(false);
      const lo = winStart ? toMs(winStart) : axisMinMs;
      const hi = winEnd ? toMs(winEnd) : axisMaxMs;
      if (which === "start") setStart(msToIso(e.key === "Home" ? axisMinMs : hi));
      else setEnd(msToIso(e.key === "End" ? axisMaxMs : lo));
      return;
    }
    const binMs = Math.max(DAY_MS, Math.round(span / BIN_COUNT / DAY_MS) * DAY_MS);
    const deltas: Record<string, number> = {
      ArrowLeft: -DAY_MS,
      ArrowDown: -DAY_MS,
      ArrowRight: DAY_MS,
      ArrowUp: DAY_MS,
      PageDown: -binMs,
      PageUp: binMs,
    };
    const delta = deltas[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    if (playing) setPlaying(false);
    nudgeHandle(which, delta);
  };

  // Typed edits drive the same window (the string clamp keeps start <= end).
  const onStartInput = (v: string) => setStart(v && winEnd && v > winEnd ? winEnd : v);
  const onEndInput = (v: string) => setEnd(v && winStart && v < winStart ? winStart : v);

  const resetWindow = () => {
    setStart("");
    setEnd("");
    setPlaying(false);
  };

  const handleInner = (
    <>
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-orange-400/60" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-5 rounded-full bg-orange-400" />
    </>
  );

  // `FIELD_TEXT` first, then the denser desktop size: `cn` resolves the two `sm:` sizes caller-last,
  // so 16px below `sm` (the editable-field floor, `Input.tsx`) and 11px above, where two dates
  // share a 240px row.
  const inputClass = cn(
    "flex-1 min-w-0 px-1 py-1 bg-neutral-800 border border-neutral-700 rounded-sm",
    "text-neutral-300 focus:outline-hidden focus:border-orange-500",
    FIELD_TEXT,
    "sm:text-[11px]",
  );

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        className="relative h-10 touch-none"
        onPointerMove={onTrackMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={() => {
          draggingRef.current = null;
        }}
      >
        {/* Activity bars, neutral (data isn't interactive); the selected window reads brighter. Orange is
            reserved for controls. */}
        <div className="absolute inset-0 flex items-end gap-px">
          {bins.map((count, i) => {
            const center = axisMinMs + ((i + 0.5) / BIN_COUNT) * span;
            const inWindow = center >= winStartMs && center <= winEndMs;
            return (
              <div
                key={i}
                className={`flex-1 rounded-t-[1px] ${inWindow ? "bg-neutral-400" : "bg-neutral-700"}`}
                style={{ height: `${Math.max(6, (count / maxBin) * 100)}%` }}
              />
            );
          })}
        </div>

        {hasAxis && span > 0 && (
          <>
            <div
              role="slider"
              aria-label={`${label} window start`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(startFrac * 100)}
              aria-valuetext={winStart}
              tabIndex={0}
              onPointerDown={(e) => beginDrag(e, "start")}
              onKeyDown={(e) => onHandleKey(e, "start")}
              className="absolute top-0 bottom-0 -ml-2 w-4 cursor-ew-resize"
              style={{ left: `${startFrac * 100}%` }}
            >
              {handleInner}
            </div>
            <div
              role="slider"
              aria-label={`${label} window end`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(endFrac * 100)}
              aria-valuetext={winEnd}
              tabIndex={0}
              onPointerDown={(e) => beginDrag(e, "end")}
              onKeyDown={(e) => onHandleKey(e, "end")}
              className="absolute top-0 bottom-0 -ml-2 w-4 cursor-ew-resize"
              style={{ left: `${endFrac * 100}%` }}
            >
              {handleInner}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-2">
        <button
          onClick={() => setPlaying((p) => !p)}
          disabled={!hasAxis || span <= 0}
          className={`flex items-center justify-center ${ICON_TAP_STEP} sm:size-6 shrink-0 rounded-sm bg-neutral-800 border border-neutral-700 text-orange-400 hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
          aria-label={playing ? "Pause" : "Play timeline"}
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        {hasAxis ? (
          <>
            <input
              type="date"
              value={winStart}
              min={dataMin || undefined}
              max={winEnd || undefined}
              onChange={(e) => onStartInput(e.target.value)}
              aria-label={`${label} window start date`}
              className={inputClass}
            />
            <span className="text-neutral-600 text-[11px] shrink-0">–</span>
            <input
              type="date"
              value={winEnd}
              min={winStart || undefined}
              max={dataMax || undefined}
              onChange={(e) => onEndInput(e.target.value)}
              aria-label={`${label} window end date`}
              className={inputClass}
            />
            {isWindowed && (
              <button
                onClick={resetWindow}
                aria-label="Reset window"
                title="Reset window"
                className={`shrink-0 flex items-center justify-center ${ICON_TAP_STEP} sm:size-5 text-neutral-500 hover:text-neutral-300 transition-colors`}
              >
                <RotateCcw size={12} />
              </button>
            )}
          </>
        ) : (
          <span className="text-[11px] text-neutral-500">No dated points</span>
        )}
      </div>
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import MapGL, {
  Source,
  Layer,
  NavigationControl,
  AttributionControl,
  useMap,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibreWorker";
import type { EventDetail, MapPoint } from "@/types";
import { usePalette } from "@/hooks/usePalette";
import { useTheme } from "@/hooks/useTheme";
import { paletteMapColors } from "@/lib/palette";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { MediaThumb } from "@/components/ui/EntityCard";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { StatusBadge } from "@/components/event/StatusBadge";
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  MapLayerMouseEvent,
  MapMouseEvent,
} from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import type { MapBounds } from "@/lib/viewport";
import { isCoarsePointer } from "@/lib/pointer";
import {
  CLUSTER_MAX_ZOOM,
  SPIDER_MAX_DOTS,
  TAP_SLOP_PX,
  groupStacks,
  isCoincidentStack,
  nearestFeature,
  ringOffsets,
  ringRadius,
} from "./stack";

// CARTO basemap pair. maplibre paint can't read CSS variables, so tiles swap off the theme here.
const BASEMAP_STYLE = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

// Hover ring: dot geometry and the grace margin (px) the pointer may roam before it collapses.
const SPIDER_DOT_PX = 12;
const SPIDER_GRACE_PX = 18;
// The CSS transition runs 150 ms; 10 ms of slack so the ring unmounts after the dots land.
const SPIDER_MERGE_MS = 160;
// Hover-intent delay before a preview shows and its detail fetch fires, so sweeping a dense
// field flashes nothing and sends no requests.
const PREVIEW_INTENT_MS = 150;
// The oldest entry is evicted past this size.
const PREVIEW_CACHE_MAX = 50;

// Layer ids. One registration covers both point layers.
const CLUSTER_LAYER = "clusters";
const STACK_LAYER = "stacks-circle";
const POINT_LAYERS = ["points-selected", "points-circle"];

// Every layer a tap can target (a query returns matches topmost first whatever the order here).
const TAP_TARGET_LAYERS = [CLUSTER_LAYER, STACK_LAYER, ...POINT_LAYERS];

// Crossfade band around the clustering ceiling, derived from CLUSTER_MAX_ZOOM.
// Supercluster serves raw points from one integer zoom past it.
const POINTS_ZOOM = CLUSTER_MAX_ZOOM + 1;
const FADE_OUT_START = CLUSTER_MAX_ZOOM + 0.5;
const FADE_IN_END = CLUSTER_MAX_ZOOM + 1.25;
// A cluster click past the ceiling overshoots the band so revealed pins land at full opacity.
const CLUSTER_OVERSHOOT_ZOOM = CLUSTER_MAX_ZOOM + 1.3;

/** Named view over the compact MapPoint tuple from /events/points. */
function mapPointFields(p: MapPoint): {
  id: string;
  lat: number;
  lng: number;
  detected: 0 | 1;
} {
  const [id, lat, lng, , , detected] = p;
  return { id, lat, lng, detected };
}

interface SpiderPoint {
  id: string;
  detected: 0 | 1;
  lng: number;
  lat: number;
}

/** An open hover ring. `key` (sorted ids) keeps re-hovering the same stack from resetting it;
 * `clusterId` is set for an unexpandable cluster so its circle hides while the ring is out. */
interface SpiderStack {
  key: string;
  center: { x: number; y: number };
  points: SpiderPoint[];
  clusterId: number | null;
}

/** A hovered pin: event id and pin center in map-container px. */
interface PreviewTarget {
  id: string;
  x: number;
  y: number;
}

function toSpiderPoints(features: Feature[]): SpiderPoint[] {
  const points: SpiderPoint[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const id = feature.properties?.id;
    if (typeof id !== "string" || seen.has(id)) continue;
    if (feature.geometry?.type !== "Point") continue;
    seen.add(id);
    const [lng, lat] = feature.geometry.coordinates;
    points.push({
      id,
      detected: feature.properties?.detected === 1 ? 1 : 0,
      lng,
      lat,
    });
  }
  return points;
}

function stackKey(points: SpiderPoint[]): string {
  return points
    .map((p) => p.id)
    .sort()
    .join("|");
}

function StackInteractions({
  onPointClick,
  onSpiderOpen,
  onSpiderClose,
  onPinHover,
  spider,
}: {
  onPointClick?: (id: string) => void;
  onSpiderOpen: (stack: SpiderStack) => void;
  onSpiderClose: () => void;
  onPinHover: (target: PreviewTarget | null) => void;
  spider: SpiderStack | null;
}) {
  const { current: map } = useMap();

  // Last pin the layer mousemove armed a preview for. A ref so the spider-open effect can reset it.
  const hoveredPinIdRef = useRef<string | null>(null);

  // Set when a layer handler took this click; the canvas tap re-test runs only on bare canvas.
  const handledRef = useRef(false);

  useEffect(() => {
    if (!map) return;

    // The unclustered stack badge carries its members inline (`stack_members` JSON); hover or tap opens the ring.
    const openFromStackFeature = (feature: Feature | undefined): boolean => {
      if (!feature || feature.geometry?.type !== "Point") return false;
      const raw = feature.properties?.stack_members;
      if (typeof raw !== "string") return false;
      let members: { id: string; detected: 0 | 1 }[];
      try {
        members = JSON.parse(raw);
      } catch {
        return false;
      }
      if (!Array.isArray(members) || members.length < 2) return false;
      const [lng, lat] = feature.geometry.coordinates;
      const px = map.project([lng, lat]);
      const points: SpiderPoint[] = members.map((m) => ({
        id: m.id,
        detected: m.detected === 1 ? 1 : 0,
        lng,
        lat,
      }));
      onSpiderOpen({
        key: stackKey(points),
        center: { x: px.x, y: px.y },
        points,
        clusterId: null,
      });
      return true;
    };

    // A cluster is a stack when it can never expand: supercluster reports an expansion zoom past
    // the ceiling and its leaves share one coordinate. Returns that zoom so the click path can
    // still ease into an ordinary cluster.
    const coincidentLeaves = async (
      clusterId: number
    ): Promise<{ zoom: number; points: SpiderPoint[] | null }> => {
      const source = map.getSource("points") as GeoJSONSource | undefined;
      if (!source) throw new Error("points source missing");
      const zoom = await source.getClusterExpansionZoom(clusterId);
      if (zoom <= CLUSTER_MAX_ZOOM) return { zoom, points: null };
      const leaves = await source.getClusterLeaves(clusterId, Infinity, 0);
      if (!isCoincidentStack(leaves)) return { zoom, points: null };
      const points = toSpiderPoints(leaves);
      return { zoom, points: points.length > 1 ? points : null };
    };

    // coincidentLeaves resolves async: the camera may have moved or the pointer left by then, and
    // the movestart close listener registers only after the ring opens. A generation counter,
    // bumped on enter, cluster mouseleave and movestart, invalidates a pending open.
    let clusterHoverGen = 0;
    const invalidateClusterHover = () => {
      clusterHoverGen++;
    };

    const handleClusterEnter = (e: MapLayerMouseEvent) => {
      // A ring opened mid-move would anchor to a stale position.
      if (map.isMoving()) return;
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const clusterId = feature.properties?.cluster_id as number | undefined;
      if (clusterId === undefined) return;
      const coordinates = feature.geometry.coordinates as [number, number];
      const gen = ++clusterHoverGen;
      coincidentLeaves(clusterId)
        .then(({ points }) => {
          if (gen !== clusterHoverGen || map.isMoving()) return;
          if (points) {
            // Project only now: a move completed during resolution would misanchor the ring.
            const center = map.project(coordinates);
            onSpiderOpen({
              key: stackKey(points),
              center: { x: center.x, y: center.y },
              points,
              clusterId,
            });
          }
        })
        .catch(() => {});
    };

    // Shared by the layer click and the slop re-test, so it raises no flag: only a click a layer took may set it.
    const clickCluster = async (feature: Feature | undefined) => {
      if (!feature || feature.geometry.type !== "Point") return;
      const coordinates = feature.geometry.coordinates as [number, number];
      const clusterId = feature.properties?.cluster_id as number | undefined;
      if (clusterId === undefined) return;

      try {
        const { zoom, points } = await coincidentLeaves(clusterId);
        if (points) {
          const center = map.project(coordinates);
          onSpiderOpen({
            key: stackKey(points),
            center: { x: center.x, y: center.y },
            points,
            clusterId,
          });
          return;
        }
        // A cluster splitting only at the ceiling lands on the crossfade low point: overshoot past the band.
        map.easeTo({
          center: coordinates,
          zoom: zoom > CLUSTER_MAX_ZOOM ? CLUSTER_OVERSHOOT_ZOOM : zoom,
        });
      } catch {
        map.easeTo({ center: coordinates, zoom: (map.getZoom() || 5) + 2 });
      }
    };
    const handleClusterClick = (e: MapLayerMouseEvent) => {
      handledRef.current = true;
      void clickCluster(e.features?.[0]);
    };

    const handleStackEnter = (e: MapLayerMouseEvent) => {
      // A ring opened mid-move would anchor to a stale position.
      if (map.isMoving()) return;
      openFromStackFeature(e.features?.[0]);
    };

    const handleStackClick = (e: MapLayerMouseEvent) => {
      handledRef.current = true;
      openFromStackFeature(e.features?.[0]);
    };

    const clickPoint = (feature: Feature | undefined) => {
      const id = feature?.properties?.id;
      if (typeof id !== "string") return;
      // The latch must follow the parent's preview clear, or re-hovering the same pin hits the equality no-op.
      hoveredPinIdRef.current = null;
      onPointClick?.(id);
    };
    const handlePointClick = (e: MapLayerMouseEvent) => {
      handledRef.current = true;
      clickPoint(e.features?.[0]);
    };

    // Tap targets present on the style, resolved on first use: the `<Layer>` children add them from
    // effects that run after this one. Filtered because `queryRenderedFeatures` throws on an unknown id.
    let tapLayers: string[] = [];
    const layersForTap = () => {
      if (tapLayers.length === 0) {
        tapLayers = TAP_TARGET_LAYERS.filter((id) => map.getLayer(id));
      }
      return tapLayers;
    };

    // A finger that misses every pin: re-test over a TAP_SLOP_PX box and take the nearest feature.
    // Coarse pointers only, and only when no layer handler took the click.
    const handleCanvasTap = (e: MapMouseEvent) => {
      // Read and clear first so the flag is down on every exit path; a stale value would swallow the
      // next canvas tap. Only the three layer click handlers raise it.
      const handled = handledRef.current;
      handledRef.current = false;
      if (handled) return;
      const layers = layersForTap();
      if (layers.length === 0) return;
      const { x, y } = e.point;
      const box: [[number, number], [number, number]] = [
        [x - TAP_SLOP_PX, y - TAP_SLOP_PX],
        [x + TAP_SLOP_PX, y + TAP_SLOP_PX],
      ];
      const target = nearestFeature(
        map.queryRenderedFeatures(box, { layers }),
        e.point,
        (coordinates) => map.project(coordinates)
      );
      if (!target) return;
      // Same destinations as the layer handlers: a cluster zooms (or fans out), a stack fans out, a pin selects.
      if (target.properties?.cluster_id !== undefined) {
        void clickCluster(target);
        return;
      }
      if (openFromStackFeature(target)) return;
      clickPoint(target);
    };

    // Any single unclustered circle under the cursor anchors the preview; the id comparison keeps
    // it a no-op until the hovered pin changes.
    const clearPinHover = () => {
      if (hoveredPinIdRef.current !== null) {
        hoveredPinIdRef.current = null;
        onPinHover(null);
      }
    };
    const handlePointMove = (e: MapLayerMouseEvent) => {
      // A preview armed mid-move would anchor to a stale position.
      if (map.isMoving()) {
        clearPinHover();
        return;
      }
      const points = toSpiderPoints(e.features ?? []);
      if (points.length !== 1) {
        // A stack under the cursor belongs to the ring, not the preview.
        clearPinHover();
        return;
      }
      const p = points[0];
      if (p.id === hoveredPinIdRef.current) return;
      hoveredPinIdRef.current = p.id;
      const px = map.project([p.lng, p.lat]);
      onPinHover({ id: p.id, x: px.x, y: px.y });
    };

    const pointerOn = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const pointerOff = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", CLUSTER_LAYER, handleClusterClick);
    map.on("mouseenter", CLUSTER_LAYER, handleClusterEnter);
    map.on("click", STACK_LAYER, handleStackClick);
    map.on("mouseenter", STACK_LAYER, handleStackEnter);
    map.on("click", POINT_LAYERS, handlePointClick);
    map.on("mousemove", POINT_LAYERS, handlePointMove);
    map.on("mouseleave", POINT_LAYERS, clearPinHover);
    map.on("movestart", clearPinHover);
    map.on("mouseleave", CLUSTER_LAYER, invalidateClusterHover);
    map.on("movestart", invalidateClusterHover);
    // Registered last so every layer click handler runs first and can report it took the tap.
    if (isCoarsePointer()) map.on("click", handleCanvasTap);
    map.on("mouseenter", CLUSTER_LAYER, pointerOn);
    map.on("mouseleave", CLUSTER_LAYER, pointerOff);
    map.on("mouseenter", STACK_LAYER, pointerOn);
    map.on("mouseleave", STACK_LAYER, pointerOff);
    map.on("mouseenter", POINT_LAYERS, pointerOn);
    map.on("mouseleave", POINT_LAYERS, pointerOff);

    return () => {
      map.off("click", CLUSTER_LAYER, handleClusterClick);
      map.off("mouseenter", CLUSTER_LAYER, handleClusterEnter);
      map.off("click", STACK_LAYER, handleStackClick);
      map.off("mouseenter", STACK_LAYER, handleStackEnter);
      map.off("click", POINT_LAYERS, handlePointClick);
      map.off("mousemove", POINT_LAYERS, handlePointMove);
      map.off("mouseleave", POINT_LAYERS, clearPinHover);
      map.off("movestart", clearPinHover);
      map.off("mouseleave", CLUSTER_LAYER, invalidateClusterHover);
      map.off("movestart", invalidateClusterHover);
      map.off("click", handleCanvasTap);
      map.off("mouseenter", CLUSTER_LAYER, pointerOn);
      map.off("mouseleave", CLUSTER_LAYER, pointerOff);
      map.off("mouseenter", STACK_LAYER, pointerOn);
      map.off("mouseleave", STACK_LAYER, pointerOff);
      map.off("mouseenter", POINT_LAYERS, pointerOn);
      map.off("mouseleave", POINT_LAYERS, pointerOff);
    };
  }, [map, onPointClick, onSpiderOpen, onPinHover]);

  // Opening a ring clears the parent's preview: reset the hover latch with it.
  useEffect(() => {
    if (spider) hoveredPinIdRef.current = null;
  }, [spider]);

  // Collapse the open ring when the map moves or the pointer leaves the grace zone. The overlay
  // swallows pointer events over its own square, so a canvas mousemove means outside it.
  useEffect(() => {
    if (!map || !spider) return;
    const radius =
      ringRadius(spider.points.length) + SPIDER_DOT_PX + SPIDER_GRACE_PX;
    const handleMove = (e: MapMouseEvent) => {
      const { x, y } = e.point;
      if (Math.hypot(x - spider.center.x, y - spider.center.y) > radius) {
        onSpiderClose();
      }
    };
    map.on("movestart", onSpiderClose);
    map.on("mousemove", handleMove);
    return () => {
      map.off("movestart", onSpiderClose);
      map.off("mousemove", handleMove);
    };
  }, [map, spider, onSpiderClose]);

  return null;
}

/** Hover preview for map pins (normal pins and ring dots). Anchored at the pin center in
 * map-container px and clamped after measuring so it stays inside the map: flips left when the
 * right lacks room, shifts vertically at the edges. */
function PinPreviewCard({
  entry,
  error,
  x,
  y,
}: {
  /** Undefined while the lazy detail fetch is in flight. */
  entry?: EventDetail;
  /** True when the detail fetch failed: terse fallback, no eternal spinner. */
  error?: boolean;
  x: number;
  y: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const maxLeft = parent.clientWidth - w - margin;
    const maxTop = parent.clientHeight - h - margin;
    let left = x + SPIDER_DOT_PX;
    if (left > maxLeft) left = x - w - SPIDER_DOT_PX;
    left = Math.min(Math.max(left, margin), Math.max(maxLeft, margin));
    const top = Math.min(Math.max(y - 10, margin), Math.max(maxTop, margin));
    setPos({ left, top });
  }, [x, y, entry, error]);

  // Backend-picked card thumbnail (source media, else proof image): the rule lives in services/thumbnails.
  const media = entry?.thumbnail ?? undefined;
  return (
    // Above the detail and filter overlays (z-1000) so a preview near a panel edge stays readable.
    <div
      ref={ref}
      className="absolute z-[1100] w-64 pointer-events-none"
      style={{
        left: pos?.left ?? x + SPIDER_DOT_PX,
        top: pos?.top ?? y - 10,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <Card className="p-3 space-y-1.5 shadow-lg">
        {entry ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-neutral-100 line-clamp-2">
                {entry.title}
              </p>
              <StatusBadge status={entry.status} />
            </div>
            <MediaThumb
              media={media}
              isGraphic={entry.is_graphic}
              className="w-full"
            />
            <p className="text-[11px] text-neutral-500">
              {entry.event_date && <>{formatDate(entry.event_date)} </>}
              <AuthorByline author={entry.owner} size="xs" />
            </p>
          </>
        ) : error ? (
          <p className="text-xs text-neutral-500">Preview unavailable</p>
        ) : (
          <p className="text-xs text-neutral-500">Loading...</p>
        )}
      </Card>
    </div>
  );
}

/** Fanned-out ring over a co-located stack: one hoverable, clickable DOM dot per event. The map
 * hides the stack while the ring is out; on close the dots return to the center (`collapsing`)
 * before the circle reappears. */
function SpiderRing({
  spider,
  selectedId,
  colors,
  collapsing,
  onSelect,
  onClose,
  onPinHover,
}: {
  spider: SpiderStack;
  selectedId?: string | null;
  colors: { base: string; detected: string; stroke: string };
  collapsing: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onPinHover: (target: PreviewTarget | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Two-frame mount so dots travel out instead of popping in; `collapsing` runs it back before
  // unmount. Remounts per stack (keyed on `spider.key`).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // A tap fires one compatibility `mousemove` and no pointer stays to travel, so none of the mouse
  // close paths fire. On a coarse pointer a tap off the ring closes it, on `pointerdown` so the
  // map handles the same tap underneath.
  useEffect(() => {
    if (!isCoarsePointer()) return;
    const handleOutside = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [onClose]);

  const out = expanded && !collapsing;
  const n = spider.points.length;
  // Past SPIDER_MAX_DOTS the last slot is a "+N" marker (the count badge carries the true total).
  const capped = n > SPIDER_MAX_DOTS;
  const shown = capped ? spider.points.slice(0, SPIDER_MAX_DOTS - 1) : spider.points;
  const slots = capped ? SPIDER_MAX_DOTS : n;
  const offsets = ringOffsets(slots);
  const half = ringRadius(slots) + SPIDER_DOT_PX + SPIDER_GRACE_PX;
  const overflow = n - shown.length;

  return (
    <div
      ref={rootRef}
      className={`absolute z-20 ${collapsing ? "pointer-events-none" : ""}`}
      style={{
        left: spider.center.x - half,
        top: spider.center.y - half,
        width: 2 * half,
        height: 2 * half,
      }}
      onMouseLeave={onClose}
      // The overlay sits above the canvas and would eat the zoom gesture: collapse so the next wheel reaches the map.
      onWheel={onClose}
    >
      {shown.map((p, i) => {
        const colour = p.detected === 1 ? colors.detected : colors.base;
        const selected = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            aria-label={`Co-located event ${i + 1} of ${n}`}
            onMouseEnter={() => {
              // At mount every dot sits under the pointer; only a fanned-out dot is a hover target.
              if (!out) return;
              onPinHover({
                id: p.id,
                x: spider.center.x + offsets[i].dx,
                y: spider.center.y + offsets[i].dy,
              });
            }}
            onMouseLeave={() => onPinHover(null)}
            onClick={() => onSelect(p.id)}
            // The dot stays SPIDER_DOT_PX wide; on a coarse pointer the pseudo-element grows the hit area to
            // 32px (12px plus 10px each side) for a fingertip. Gated on `pointer-coarse:` so a mouse keeps
            // its exact 12px target and no box steals a neighbour's hover.
            className="absolute rounded-full cursor-pointer transition-transform duration-150 ease-out before:absolute pointer-coarse:before:-inset-2.5 before:content-['']"
            style={{
              left: half - SPIDER_DOT_PX / 2,
              top: half - SPIDER_DOT_PX / 2,
              width: SPIDER_DOT_PX,
              height: SPIDER_DOT_PX,
              backgroundColor: colour,
              border: selected
                ? `2px solid ${colors.stroke}`
                : `1px solid ${colour}`,
              transform: out
                ? `translate(${offsets[i].dx}px, ${offsets[i].dy}px)`
                : "translate(0, 0)",
            }}
          />
        );
      })}
      {capped && (
        <span
          role="img"
          aria-label={`${overflow} more co-located events`}
          title={`${overflow} more co-located events`}
          className="absolute flex items-center justify-center rounded-full text-[9px] font-medium text-white transition-transform duration-150 ease-out"
          style={{
            left: half - 9,
            top: half - 9,
            minWidth: 18,
            height: 18,
            padding: "0 3px",
            backgroundColor: colors.base,
            transform: out
              ? `translate(${offsets[slots - 1].dx}px, ${offsets[slots - 1].dy}px)`
              : "translate(0, 0)",
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
// Zoom floor: at 1.8 the globe stays fully visible with a small margin (2.1 clips the poles on a laptop).
const MIN_ZOOM = 1.8;

// Ceiling for a `fitBounds` camera: a single-point box has no scale of its own, so cap at a regional read.
const FIT_MAX_ZOOM = 9;
// Padding (px) so an extreme point doesn't sit under the map controls.
const FIT_PADDING = 32;

// `flyTo` landing zoom (the `fitBounds` ceiling, so a sequence frame and one item read at the same
// scale) and flight duration. A reader zoomed in past it keeps their zoom.
const FLY_ZOOM = FIT_MAX_ZOOM;
const FLY_MS = 900;

// Opacity of a pin in `dimmedIds`: behind its neighbours, still on the map.
const DIMMED_OPACITY = 0.35;

interface MapProps {
  points: MapPoint[];
  selectedId?: string | null;
  onPointClick?: (id: string) => void;
  className?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  /** Frame the camera on this box instead of `center`/`zoom`, for views derived from their own
   * content (profile map). Applied on mount and on change. `east` may exceed 180 for a box
   * crossing the antimeridian, as MapLibre reads it. */
  fitBounds?: MapBounds;
  /** Flies the camera here on change. The first value is the caller's own frame and moves nothing.
   * Null leaves the camera where it is. */
  flyTo?: { lat: number; lng: number } | null;
  /** Ids drawn at reduced strength (steps already walked past). A dimmed pin keeps its colour,
   * stack and click; the selected pin is never dimmed. */
  dimmedIds?: ReadonlySet<string>;
  // Reports pan/zoom on every move-end so the parent can persist it; the map stays uncontrolled.
  onViewChange?: (view: { latitude: number; longitude: number; zoom: number }) => void;
  // Reports the visible rectangle once the map exists and on every move-end (`/events/points`
  // requires a bbox). Separate from onViewChange, which skips the layout move-end.
  onBoundsChange?: (bounds: MapBounds) => void;
  /** Marks a map inside a scrolling article (event page, profile map). `cooperativeGestures` hands
   * the one-finger swipe back to the page (two fingers pan, Command or Ctrl plus wheel zooms).
   * `/map` leaves it unset: there the map is the page. */
  embedded?: boolean;
}

/** Reports the visible rectangle to the parent (`/events/points` requires a bbox): once the map
 * exists, then on every move-end. Not hung off the style `load` event: `getBounds()` answers right
 * away, and waiting for `load` would tie the catalog fetch to the basemap CDN. */
function BoundsReporter({
  onBoundsChange,
}: {
  onBoundsChange?: (bounds: MapBounds) => void;
}) {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map || !onBoundsChange) return;
    // LngLat objects, unwrapped past the antimeridian: flatten and let `lib/viewport` normalise.
    const report = () => {
      const b = map.getBounds();
      onBoundsChange({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      });
    };
    report();
    map.on("moveend", report);
    return () => {
      map.off("moveend", report);
    };
  }, [map, onBoundsChange]);
  return null;
}

/** Frames the camera on a bounds box. Keys on the four numbers, so an equal box doesn't re-fit. */
function FitBoundsCamera({ bounds }: { bounds: MapBounds }) {
  const { current: map } = useMap();
  const { west, south, east, north } = bounds;

  useEffect(() => {
    if (!map) return;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, duration: 0 }
    );
  }, [map, west, south, east, north]);

  return null;
}

/** Flies the camera to a point whenever it changes (the collection page follows a step). The
 * first target is skipped: the reader opens framed on the whole sequence. No `essential` flag,
 * so reduced motion gets the camera without the flight. Mounted for the map's life even while
 * the target is null, so the latch is spent once on the caller's frame. */
function FlyToCamera({ target }: { target: { lat: number; lng: number } | null }) {
  const { current: map } = useMap();
  const framed = useRef(false);
  const lat = target?.lat ?? null;
  const lng = target?.lng ?? null;

  useEffect(() => {
    if (!map) return;
    if (!framed.current) {
      framed.current = true;
      return;
    }
    if (lat === null || lng === null) return;
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), FLY_ZOOM),
      duration: FLY_MS,
    });
  }, [map, lat, lng]);

  return null;
}

// Dev-only camera handle for the promo-recording pipeline (video/): exposes the maplibre instance
// for Playwright easeTo moves. Gated at the render site, so never mounted in production.
function DevMapHandle() {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map) return;
    const w = window as unknown as { __viditMap?: unknown };
    w.__viditMap = map.getMap();
    return () => {
      delete w.__viditMap;
    };
  }, [map]);
  return null;
}

export default function Map({
  points,
  selectedId,
  onPointClick,
  className,
  center,
  zoom,
  fitBounds,
  flyTo,
  dimmedIds,
  onViewChange,
  onBoundsChange,
  embedded = false,
}: MapProps) {
  const [mounted, setMounted] = useState(false);
  // MapLibre needs WebGL, which Tor Browser gates; detect on mount to show a message, not a black canvas.
  const [webglMissing, setWebglMissing] = useState(false);
  // Skip the first onMoveEnd (initial layout): it carries the values just seeded.
  const firstMoveEndRef = useRef(true);
  // Marker colours follow the accent palette; detections use a lighter shade of the same hue.
  const marker = paletteMapColors(usePalette());
  const DETECTED = marker.detected;
  const theme = useTheme();
  // Halo around the selected point: white on the dark basemap, a dark ring on light Positron.
  const SELECTED_STROKE = theme === "light" ? "#1a1a1a" : "#ffffff";

  // Open hover ring. Closing is two-phase: `spiderClosing` runs the dots back to the center, then
  // the timer unmounts the ring and the hidden circle reappears.
  const [spider, setSpider] = useState<SpiderStack | null>(null);
  const [spiderClosing, setSpiderClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The ceiling crossfade dip applies only while a zoom is in flight; a static ramp would dim
  // layers that come to rest inside the band (e.g. z14.8).
  const [zoomInFlight, setZoomInFlight] = useState(false);

  // Hovered pin preview: shown, and its detail fetched, only after the intent delay. The bounded
  // cache holds settled details and in-flight promises so a re-hover reuses them.
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<EventDetail | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const previewIdRef = useRef<string | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailCacheRef = useRef<
    globalThis.Map<string, EventDetail | Promise<EventDetail>>
  >(new globalThis.Map());

  const hoverPin = useCallback((raw: PreviewTarget | null) => {
    // A tap fires one compatibility `mousemove` before its click, which would arm the timer, open
    // the card over the selected pin and fetch twice. A coarse pointer arms no preview: only the
    // clearing half runs. This is the single choke point for the layer `mousemove` and ring dot `onMouseEnter`.
    const target = raw && isCoarsePointer() ? null : raw;
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    previewIdRef.current = target?.id ?? null;
    setPreview(target);
    setPreviewVisible(false);
    setPreviewError(false);
    const cached = target ? detailCacheRef.current.get(target.id) : undefined;
    setPreviewEntry(cached instanceof Promise ? null : cached ?? null);
    if (!target) return;
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      setPreviewVisible(true);
      const cache = detailCacheRef.current;
      let entry = cache.get(target.id);
      if (entry === undefined) {
        const promise = apiFetch<EventDetail>(`/events/${target.id}`);
        entry = promise;
        cache.set(target.id, promise);
        promise
          .then((detail) => {
            if (cache.get(target.id) === promise) cache.set(target.id, detail);
          })
          .catch(() => {
            // A failed fetch never caches: the next hover retries.
            if (cache.get(target.id) === promise) cache.delete(target.id);
          });
        if (cache.size > PREVIEW_CACHE_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
      } else {
        // LRU touch: re-insert so the eviction order tracks recency.
        cache.delete(target.id);
        cache.set(target.id, entry);
      }
      if (entry instanceof Promise) {
        entry
          .then((detail) => {
            if (previewIdRef.current === target.id) setPreviewEntry(detail);
          })
          .catch(() => {
            if (previewIdRef.current === target.id) setPreviewError(true);
          });
      } else {
        setPreviewEntry(entry);
      }
    }, PREVIEW_INTENT_MS);
  }, []);
  useEffect(
    () => () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    },
    []
  );

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  const openSpider = useCallback(
    (stack: SpiderStack) => {
      clearCloseTimer();
      setSpiderClosing(false);
      // The ring replaces any plain pin preview under the cursor.
      hoverPin(null);
      // Re-hovering the same stack keeps the open ring and its animation.
      setSpider((cur) => (cur && cur.key === stack.key ? cur : stack));
    },
    [clearCloseTimer, hoverPin]
  );
  const closeSpider = useCallback(() => {
    hoverPin(null);
    if (closeTimerRef.current) return;
    setSpiderClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setSpider(null);
      setSpiderClosing(false);
    }, SPIDER_MERGE_MS);
  }, [hoverPin]);
  const handlePinClick = useCallback(
    (id: string) => {
      // Opening the side panel likely precedes an edit: drop the cached preview so the next hover refetches.
      detailCacheRef.current.delete(id);
      hoverPin(null);
      onPointClick?.(id);
    },
    [hoverPin, onPointClick]
  );
  const selectFromSpider = useCallback(
    (id: string) => {
      clearCloseTimer();
      setSpider(null);
      setSpiderClosing(false);
      handlePinClick(id);
    },
    [clearCloseTimer, handlePinClick]
  );

  useEffect(() => {
    let ok = false;
    try {
      const canvas = document.createElement("canvas");
      ok = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      ok = false;
    }
    setWebglMissing(!ok);
    setMounted(true);
  }, []);

  // While a ring is out its stack is hidden underneath: the cluster circle by `cluster_id`,
  // unclustered circles by event id. On close the filters relax so circles re-merge.
  const clusterFilter = useMemo<FilterSpecification>(() => {
    const base: unknown = ["has", "point_count"];
    if (spider?.clusterId == null) return base as FilterSpecification;
    const hidden: unknown = [
      "all",
      base,
      ["!=", ["get", "cluster_id"], spider.clusterId],
    ];
    return hidden as FilterSpecification;
  }, [spider]);
  const spiderHiddenIds = useMemo<unknown | null>(() => {
    if (!spider || spider.clusterId != null) return null;
    return [
      "!",
      ["in", ["get", "id"], ["literal", spider.points.map((p) => p.id)]],
    ];
  }, [spider]);
  const pointFilter = useCallback(
    (selectedFlag: 0 | 1): FilterSpecification => {
      const base: unknown[] = [
        "all",
        ["!", ["has", "point_count"]],
        ["==", ["get", "stack_count"], 1],
        ["==", ["get", "selected"], selectedFlag],
      ];
      if (spiderHiddenIds) base.push(spiderHiddenIds);
      return base as FilterSpecification;
    },
    [spiderHiddenIds]
  );
  const stackFilter = useMemo<FilterSpecification>(() => {
    const base: unknown[] = [
      "all",
      ["!", ["has", "point_count"]],
      ["has", "stack_rep"],
    ];
    if (spiderHiddenIds) base.push(spiderHiddenIds);
    return base as FilterSpecification;
  }, [spiderHiddenIds]);

  // Group co-located points (~1 m epsilon grid, `groupStacks`): all stay in the source so cluster
  // counts stay true, but past the ceiling only the first renders, as the counted stack badge.
  // A stack of 3 must never look like one pin.
  const geojson = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    for (const stack of groupStacks(points, mapPointFields)) {
      const stackCount = stack.length;
      const members = stack.map((p) => {
        const { id, detected } = mapPointFields(p);
        return { id, detected };
      });
      const anySelected = stack.some((p) => mapPointFields(p).id === selectedId);
      stack.forEach((p, i) => {
        const { id, lat, lng, detected } = mapPointFields(p);
        features.push({
          type: "Feature",
          properties: {
            id,
            selected: id === selectedId ? 1 : 0,
            // 1 for a step already walked past (paint takes it to `DIMMED_OPACITY`). Always written so the
            // expression reads a property that exists on every feature.
            dimmed: dimmedIds?.has(id) ? 1 : 0,
            // 1 for a machine detection: painted amber.
            detected,
            stack_count: stackCount,
            ...(stackCount > 1 && i === 0
              ? {
                  stack_rep: 1,
                  stack_members: JSON.stringify(members),
                  stack_selected: anySelected ? 1 : 0,
                }
              : {}),
          },
          geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
        });
      });
    }
    return { type: "FeatureCollection", features };
  }, [points, selectedId, dimmedIds]);

  // A walked-past pin loses strength only. Applied per opacity value because a `zoom` expression is
  // legal only as input of a top-level `step`/`interpolate`: the crossfade stays outside and this
  // rides each stop. No-op where nothing is dimmed.
  const withDim = (opacity: number): number | ExpressionSpecification =>
    dimmedIds === undefined
      ? opacity
      : ["case", ["==", ["get", "dimmed"], 1], DIMMED_OPACITY, opacity];

  // A points swap rebuilds the source and supercluster reassigns cluster ids: an open ring could
  // hide the wrong cluster and reference filtered-out events. Reset the overlay and preview.
  useEffect(() => {
    clearCloseTimer();
    setSpider(null);
    setSpiderClosing(false);
    hoverPin(null);
  }, [geojson, clearCloseTimer, hoverPin]);

  if (!mounted) {
    return (
      <div className={`w-full h-full bg-neutral-950 flex items-center justify-center ${className || ""}`}>
        <span className="text-neutral-500 text-sm">Loading map...</span>
      </div>
    );
  }

  if (webglMissing) {
    return (
      <div className={`w-full h-full bg-neutral-950 flex items-center justify-center px-6 ${className || ""}`}>
        <p className="max-w-md text-center text-neutral-400 text-sm">
          The map needs WebGL, which is disabled in your browser. If you&apos;re on Tor Browser, switch the security level to Standard.
        </p>
      </div>
    );
  }

  return (
    <div
      className={className || ""}
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
    <MapGL
      initialViewState={{
        latitude: center?.lat ?? 48.5,
        longitude: center?.lng ?? 35.0,
        zoom: Math.max(zoom ?? 5, MIN_ZOOM),
      }}
      minZoom={MIN_ZOOM}
      // No symbol fade hold: MapLibre keeps an outgoing tile with symbol buckets alive for fadeDuration
      // (300 ms), so its circles vanish while labels linger. Zero swaps both on the same frame; the
      // ceiling handoff still eases via the zoom crossfade. Costs the basemap its place-label fade-in.
      fadeDuration={0}
      onMoveEnd={(evt) => {
        if (firstMoveEndRef.current) {
          firstMoveEndRef.current = false;
          return;
        }
        if (!onViewChange) return;
        const { latitude, longitude, zoom: z } = evt.viewState;
        onViewChange({ latitude, longitude, zoom: z });
      }}
      onZoomStart={() => setZoomInFlight(true)}
      onZoomEnd={() => setZoomInFlight(false)}
      style={{ width: "100%", height: "100%" }}
      mapStyle={BASEMAP_STYLE[theme]}
      projection="globe"
      attributionControl={false}
      cooperativeGestures={embedded}
    >
      <StackInteractions
        onPointClick={handlePinClick}
        onSpiderOpen={openSpider}
        onSpiderClose={closeSpider}
        onPinHover={hoverPin}
        spider={spider}
      />
      {fitBounds && <FitBoundsCamera bounds={fitBounds} />}
      <FlyToCamera target={flyTo ?? null} />
      <BoundsReporter onBoundsChange={onBoundsChange} />
      {process.env.NODE_ENV !== "production" && <DevMapHandle />}
      <NavigationControl position="bottom-left" showCompass={false} />
      <AttributionControl position="bottom-left" compact={false} />

      <Source
        id="points"
        type="geojson"
        data={geojson}
        cluster={true}
        clusterMaxZoom={CLUSTER_MAX_ZOOM}
        clusterRadius={50}
      >
        <Layer
          id="clusters"
          type="circle"
          filter={clusterFilter}
          paint={{
            "circle-color": [
              "step",
              ["get", "point_count"],
              marker.base,
              1000, marker.rampMid,
              10000, marker.rampHigh,
            ],
            // Ease the ceiling handoff: clusters thin out approaching it, replacements fade in from the same
            // level. Zoom-interpolated, only while a zoom is in flight (`zoomInFlight`).
            "circle-opacity": zoomInFlight
              ? [
                  "interpolate", ["linear"], ["zoom"],
                  FADE_OUT_START, 0.85,
                  POINTS_ZOOM, 0.35,
                ]
              : 0.85,
            "circle-radius": [
              "step",
              ["get", "point_count"],
              12,       // < 50
              50, 16,   // 50-199
              200, 20,  // 200-999
              1000, 26, // 1k-4999
              5000, 34, // 5k-9999
              10000, 42, // 10k+
            ],
          }}
        />

        <Layer
          id="cluster-count"
          type="symbol"
          filter={clusterFilter}
          layout={{
            "text-field": "{point_count_abbreviated}",
            "text-font": ["Montserrat Medium", "Noto Sans Regular"],
            "text-size": [
              "step",
              ["get", "point_count"],
              11,
              1000, 13,
              10000, 15,
            ],
            // Skip symbol placement and its collision fade: a count must appear and vanish with its circle.
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            // Mirrors the cluster circle's ceiling fade above.
            "text-opacity": zoomInFlight
              ? [
                  "interpolate", ["linear"], ["zoom"],
                  FADE_OUT_START, 1,
                  POINTS_ZOOM, 0.35,
                ]
              : 1,
          }}
        />

        <Layer
          id="points-selected"
          type="circle"
          filter={pointFilter(1)}
          paint={{
            "circle-radius": 7,
            "circle-color": ["case", ["==", ["get", "detected"], 1], DETECTED, marker.base],
            "circle-stroke-color": SELECTED_STROKE,
            "circle-stroke-width": 2,
            // No crossfade dip: the selected pin keeps full prominence through the handoff.
            "circle-opacity": 1,
          }}
        />

        <Layer
          id="points-circle"
          type="circle"
          filter={pointFilter(0)}
          paint={{
            "circle-radius": 6,
            // Lighter accent shade for a machine detection, full accent for a submitted row.
            "circle-color": ["case", ["==", ["get", "detected"], 1], DETECTED, marker.base],
            "circle-stroke-color": ["case", ["==", ["get", "detected"], 1], DETECTED, marker.base],
            "circle-stroke-width": 1,
            // The crossfade's other half: pins released by a dissolving cluster fade in from its hand-off
            // opacity (only while a zoom is in flight, see `zoomInFlight`).
            "circle-opacity": zoomInFlight
              ? [
                  "interpolate", ["linear"], ["zoom"],
                  POINTS_ZOOM - 0.01, withDim(1),
                  POINTS_ZOOM, withDim(0.35),
                  FADE_IN_END, withDim(1),
                ]
              : withDim(1),
          }}
        />

        {/* Stack badge: styled like the small cluster it resolved from so crossing the ceiling shows no
            change; a stack fans out, a cluster zooms. The selected halo moves onto it. */}
        <Layer
          id="stacks-circle"
          type="circle"
          filter={stackFilter}
          paint={{
            "circle-radius": 12,
            "circle-color": marker.base,
            // A badge exists only past the ceiling: fading in from the cluster hand-off opacity completes the
            // crossfade (only while a zoom is in flight).
            "circle-opacity": zoomInFlight
              ? [
                  "interpolate", ["linear"], ["zoom"],
                  POINTS_ZOOM, 0.35,
                  FADE_IN_END, 0.85,
                ]
              : 0.85,
            "circle-stroke-color": SELECTED_STROKE,
            "circle-stroke-width": ["case", ["==", ["get", "stack_selected"], 1], 2, 0],
          }}
        />

        <Layer
          id="stacks-count"
          type="symbol"
          filter={stackFilter}
          layout={{
            "text-field": "{stack_count}",
            "text-font": ["Montserrat Medium", "Noto Sans Regular"],
            "text-size": 11,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            // Mirrors the stack circle's fade-in above.
            "text-opacity": zoomInFlight
              ? [
                  "interpolate", ["linear"], ["zoom"],
                  POINTS_ZOOM, 0.35,
                  FADE_IN_END, 1,
                ]
              : 1,
          }}
        />
      </Source>
    </MapGL>

    {spider && (
      <SpiderRing
        key={spider.key}
        spider={spider}
        selectedId={selectedId}
        colors={{
          base: marker.base,
          detected: DETECTED,
          stroke: SELECTED_STROKE,
        }}
        collapsing={spiderClosing}
        onSelect={selectFromSpider}
        onClose={closeSpider}
        onPinHover={hoverPin}
      />
    )}

    {preview && previewVisible && (
      <PinPreviewCard
        entry={previewEntry ?? undefined}
        error={previewError}
        x={preview.x}
        y={preview.y}
      />
    )}
    </div>
  );
}

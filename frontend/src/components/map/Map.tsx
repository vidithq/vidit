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
  FilterSpecification,
  GeoJSONSource,
  MapLayerMouseEvent,
  MapMouseEvent,
} from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import {
  CLUSTER_MAX_ZOOM,
  isCoincidentStack,
  ringOffsets,
  ringRadius,
  stackCellKey,
} from "./stack";

// CARTO basemap pair, matched light / dark tiles. maplibre paint can't read CSS
// variables, so the base tiles swap here off the theme rather than in the CSS
// neutral remap that flips the rest of the UI (see globals.css).
const BASEMAP_STYLE = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

// The hover ring over a co-located stack: dot geometry plus the grace margin
// (px) the pointer may roam around the ring before it collapses.
const SPIDER_DOT_PX = 12;
const SPIDER_GRACE_PX = 18;
// How long the dots take to merge back into the center on close; matches the
// dots' transition duration so the ring unmounts as they land.
const SPIDER_MERGE_MS = 160;
// Hover-intent delay before a pin's preview card shows, so sweeping the
// pointer across a dense field doesn't flash previews.
const PREVIEW_INTENT_MS = 150;
const PREVIEW_WIDTH_PX = 256;

/** One event in an open hover ring. */
interface SpiderPoint {
  id: string;
  detected: 0 | 1;
  lng: number;
  lat: number;
}

/** An open hover ring: the stacked events plus their shared screen anchor.
 *  `key` identifies the stack (sorted ids), so re-hovering the same stack
 *  never resets an already-open ring. `clusterId` is set when the stack was
 *  an unexpandable cluster, so the map can hide that cluster circle while
 *  the ring is out. */
interface SpiderStack {
  key: string;
  center: { x: number; y: number };
  points: SpiderPoint[];
  clusterId: number | null;
}

/** A hovered pin (a normal unclustered pin or a ring dot): its event id and
 *  the pin center in map-container px, anchoring the preview card. */
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

  useEffect(() => {
    if (!map) return;

    // The unclustered stack badge carries its members inline
    // (`stack_members`, JSON, written at geojson build time): hovering or
    // tapping it opens the ring over exactly those events.
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

    // A cluster is a stack when it can never expand: supercluster reports an
    // expansion zoom past the clustering ceiling exactly when the cluster
    // splits only because clustering stops, and its leaves all share one
    // coordinate. Returns the expansion zoom so the click path can still
    // ease into an ordinary cluster.
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

    const handleClusterEnter = (e: MapLayerMouseEvent) => {
      // While the camera animates, features pass under a still pointer; a
      // ring opened mid-move would anchor to a stale position.
      if (map.isMoving()) return;
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const clusterId = feature.properties?.cluster_id as number | undefined;
      if (clusterId === undefined) return;
      const center = map.project(
        feature.geometry.coordinates as [number, number]
      );
      coincidentLeaves(clusterId)
        .then(({ points }) => {
          if (points) {
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

    const handleClusterClick = async (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const coordinates = feature.geometry.coordinates as [number, number];
      const clusterId = feature.properties?.cluster_id as number | undefined;
      if (clusterId === undefined) return;

      try {
        const { zoom, points } = await coincidentLeaves(clusterId);
        if (points) {
          // The tap fallback for touch (no hover): open the same ring.
          const center = map.project(coordinates);
          onSpiderOpen({
            key: stackKey(points),
            center: { x: center.x, y: center.y },
            points,
            clusterId,
          });
          return;
        }
        // A cluster that only splits at the ceiling would land exactly on
        // the crossfade's low point (z15): overshoot past the ramp so the
        // revealed pins arrive at full opacity.
        map.easeTo({
          center: coordinates,
          zoom: zoom > CLUSTER_MAX_ZOOM ? CLUSTER_MAX_ZOOM + 1.3 : zoom,
        });
      } catch {
        map.easeTo({ center: coordinates, zoom: (map.getZoom() || 5) + 2 });
      }
    };

    const handleStackEnter = (e: MapLayerMouseEvent) => {
      // While the camera animates, features pass under a still pointer; a
      // ring opened mid-move would anchor to a stale position.
      if (map.isMoving()) return;
      openFromStackFeature(e.features?.[0]);
    };

    // Tap fallback for touch (no hover): the badge opens the same ring.
    const handleStackClick = (e: MapLayerMouseEvent) => {
      openFromStackFeature(e.features?.[0]);
    };

    const handlePointClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") onPointClick?.(id);
    };

    // Generic pin hover: any single unclustered circle under the cursor
    // anchors the preview card. Layer-scoped mousemove only fires over the
    // layers' features, and the id comparison keeps it a no-op until the
    // hovered pin actually changes.
    let hoveredPinId: string | null = null;
    const clearPinHover = () => {
      if (hoveredPinId !== null) {
        hoveredPinId = null;
        onPinHover(null);
      }
    };
    const handlePointMove = (e: MapLayerMouseEvent) => {
      // While the map pans or zooms, pins travel under a still pointer; a
      // preview armed mid-move would anchor to a stale position.
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
      if (p.id === hoveredPinId) return;
      hoveredPinId = p.id;
      const px = map.project([p.lng, p.lat]);
      onPinHover({ id: p.id, x: px.x, y: px.y });
    };

    // One registration over both point layers, so the selected pin behaves
    // like any other for hover and click.
    const pointLayers = ["points-circle", "points-selected"];
    map.on("click", "clusters", handleClusterClick);
    map.on("mouseenter", "clusters", handleClusterEnter);
    map.on("click", "stacks-circle", handleStackClick);
    map.on("mouseenter", "stacks-circle", handleStackEnter);
    map.on("click", pointLayers, handlePointClick);
    map.on("mousemove", pointLayers, handlePointMove);
    map.on("mouseleave", pointLayers, clearPinHover);
    map.on("movestart", clearPinHover);

    const pointerOn = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const pointerOff = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("mouseenter", "clusters", pointerOn);
    map.on("mouseleave", "clusters", pointerOff);
    map.on("mouseenter", "stacks-circle", pointerOn);
    map.on("mouseleave", "stacks-circle", pointerOff);
    map.on("mouseenter", "points-circle", pointerOn);
    map.on("mouseleave", "points-circle", pointerOff);

    return () => {
      map.off("click", "clusters", handleClusterClick);
      map.off("mouseenter", "clusters", handleClusterEnter);
      map.off("click", "stacks-circle", handleStackClick);
      map.off("mouseenter", "stacks-circle", handleStackEnter);
      map.off("click", pointLayers, handlePointClick);
      map.off("mousemove", pointLayers, handlePointMove);
      map.off("mouseleave", pointLayers, clearPinHover);
      map.off("movestart", clearPinHover);
      map.off("mouseenter", "clusters", pointerOn);
      map.off("mouseleave", "clusters", pointerOff);
      map.off("mouseenter", "stacks-circle", pointerOn);
      map.off("mouseleave", "stacks-circle", pointerOff);
      map.off("mouseenter", "points-circle", pointerOn);
      map.off("mouseleave", "points-circle", pointerOff);
    };
  }, [map, onPointClick, onSpiderOpen, onPinHover]);

  // Collapse the open ring when the map moves under it or the pointer roams
  // past the grace zone. The ring overlay swallows pointer events over its
  // own square, so a canvas mousemove already means "outside the overlay";
  // the distance check keeps a symmetric grace margin around it.
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

/** The one hover preview for map pins (normal pins and ring dots share it):
 *  title, status badge, the fixed media slot (`MediaThumb`: the source-media
 *  thumbnail, or its "no media" box), date and author. Anchored at the pin
 *  center in map-container px, and clamped after measuring so the card is
 *  always fully inside the map area: it flips left of the pin when the right
 *  side lacks room, and shifts vertically along the edges. */
function PinPreviewCard({
  entry,
  x,
  y,
}: {
  /** Undefined while the lazy detail fetch is in flight. */
  entry?: EventDetail;
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
  }, [x, y, entry]);

  const media = entry?.media.find((m) => m.role === "source");
  return (
    // Above the detail / filter overlays (z-1000): a preview near a panel
    // edge must stay fully readable, and it is transient hover chrome.
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
            <MediaThumb media={media} className="w-full" />
            <p className="text-[11px] text-neutral-500">
              {entry.event_date && <>{formatDate(entry.event_date)} </>}
              <AuthorByline author={entry.owner} size="xs" />
            </p>
          </>
        ) : (
          <p className="text-xs text-neutral-500">Loading...</p>
        )}
      </Card>
    </div>
  );
}

/** The fanned-out ring over a co-located stack: one DOM dot per event around
 *  the shared center, each hoverable (the shared `PinPreviewCard`) and
 *  clickable (opens the event exactly like a normal pin). While the ring is
 *  out, the map hides the stack it split from; on close the dots travel back
 *  to the center before the circle reappears (`collapsing`). Map markers are
 *  part of the bespoke map surface. */
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
  /** True while the ring merges back into the center before unmounting. */
  collapsing: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onPinHover: (target: PreviewTarget | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Two-frame mount so the dots travel from the shared center out to the
  // ring instead of popping in place; `collapsing` runs the same transition
  // back to the center before the parent unmounts the ring. The component
  // remounts per stack (the parent keys it on `spider.key`).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const out = expanded && !collapsing;
  const n = spider.points.length;
  const offsets = ringOffsets(n);
  const half = ringRadius(n) + SPIDER_DOT_PX + SPIDER_GRACE_PX;

  return (
    <div
      className={`absolute z-20 ${collapsing ? "pointer-events-none" : ""}`}
      style={{
        left: spider.center.x - half,
        top: spider.center.y - half,
        width: 2 * half,
        height: 2 * half,
      }}
      onMouseLeave={onClose}
      // The overlay sits above the canvas, so a wheel over it would
      // otherwise silently eat the zoom gesture: collapse and let the next
      // wheel reach the map.
      onWheel={onClose}
    >
      {spider.points.map((p, i) => {
        const colour = p.detected === 1 ? colors.detected : colors.base;
        const selected = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            aria-label="Co-located event"
            onMouseEnter={() => {
              // At mount every dot still sits under the pointer at the
              // shared center; only a fanned-out dot is a hover target.
              if (!out) return;
              onPinHover({
                id: p.id,
                x: spider.center.x + offsets[i].dx,
                y: spider.center.y + offsets[i].dy,
              });
            }}
            onMouseLeave={() => onPinHover(null)}
            onClick={() => onSelect(p.id)}
            className="absolute rounded-full cursor-pointer transition-transform duration-150 ease-out"
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
    </div>
  );
}

interface MapProps {
  points: MapPoint[];
  selectedId?: string | null;
  onPointClick?: (id: string) => void;
  className?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  // Reports pan/zoom on every move-end so the parent can persist it across
  // navigation. State preservation only: the map stays uncontrolled internally.
  onViewChange?: (view: { latitude: number; longitude: number; zoom: number }) => void;
}

export default function Map({
  points,
  selectedId,
  onPointClick,
  className,
  center,
  zoom,
  onViewChange,
}: MapProps) {
  const [mounted, setMounted] = useState(false);
  // MapLibre needs WebGL, which Tor Browser disables or gates; without
  // this the user gets a black canvas. Detect on mount to swap a message in.
  const [webglMissing, setWebglMissing] = useState(false);
  // Skip the first onMoveEnd MapLibre fires during initial layout: it
  // carries the values we just seeded, so reporting it back is no-op noise.
  const firstMoveEndRef = useRef(true);
  // Marker colours follow the user's accent palette: submitted points + the
  // density ramp use the accent hue, machine detections a lighter shade of the
  // same hue (distinct by lightness, not a separate colour).
  const marker = paletteMapColors(usePalette());
  const DETECTED = marker.detected;
  const theme = useTheme();
  // Halo around the selected point: white reads on the dark basemap, but
  // vanishes on light Positron, so flip it to a dark ring in light mode.
  const SELECTED_STROKE = theme === "light" ? "#1a1a1a" : "#ffffff";

  // The open hover ring over a co-located stack. Closing is two-phase:
  // `spiderClosing` runs the dots back to the center (the visual re-merge),
  // then the timer unmounts the ring and the hidden map circle reappears in
  // its place.
  const [spider, setSpider] = useState<SpiderStack | null>(null);
  const [spiderClosing, setSpiderClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The hovered pin's preview: target set on hover, card shown after the
  // intent delay, detail fetched lazily with an in-memory per-id cache.
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<EventDetail | null>(null);
  const previewIdRef = useRef<string | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailCacheRef = useRef<globalThis.Map<string, EventDetail>>(
    new globalThis.Map()
  );

  const hoverPin = useCallback((target: PreviewTarget | null) => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    previewIdRef.current = target?.id ?? null;
    setPreview(target);
    setPreviewVisible(false);
    setPreviewEntry(target ? detailCacheRef.current.get(target.id) ?? null : null);
    if (!target) return;
    // Prefetch during the intent delay so the card usually opens hydrated;
    // a stale response (pointer moved on) is ignored via previewIdRef.
    if (!detailCacheRef.current.has(target.id)) {
      apiFetch<EventDetail>(`/events/${target.id}`)
        .then((detail) => {
          detailCacheRef.current.set(target.id, detail);
          if (previewIdRef.current === target.id) setPreviewEntry(detail);
        })
        .catch(() => {});
    }
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      setPreviewVisible(true);
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
      // Re-hovering the same stack keeps the open ring (and its fan-out
      // animation) instead of restarting it.
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

  // While a ring is out, the stack it split from disappears underneath it:
  // the cluster circle (and its count) by `cluster_id`, the unclustered
  // circles by their event ids. The dots visually replace them; on close the
  // filters relax as the ring unmounts, so the circles re-merge in place.
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

  // Group co-located points (same ~1 m grid cell, `stackCellKey`): every
  // member stays in the source so cluster counts remain true, but past the
  // clustering ceiling only the group's first point renders, as the counted
  // stack badge (`stack_rep` + inline members). A stack of 3 must never
  // masquerade as one plain pin.
  const geojson = useMemo<FeatureCollection>(() => {
    const cells = new globalThis.Map<string, MapPoint[]>();
    for (const p of points) {
      const key = stackCellKey(p[1], p[2]);
      const cell = cells.get(key);
      if (cell) cell.push(p);
      else cells.set(key, [p]);
    }
    const features: Feature[] = [];
    for (const cell of cells.values()) {
      const stackCount = cell.length;
      const members = cell.map(([id, , , , , detected]) => ({ id, detected }));
      const anySelected = cell.some((p) => p[0] === selectedId);
      cell.forEach(([id, lat, lng, , , detected], i) => {
        features.push({
          type: "Feature",
          properties: {
            id,
            selected: id === selectedId ? 1 : 0,
            // 1 for a machine detection: the marker paint colours it amber
            // so a detected point reads distinct from a submitted one at a
            // glance.
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
  }, [points, selectedId]);

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
        zoom: zoom ?? 5,
      }}
      onMoveEnd={(evt) => {
        if (firstMoveEndRef.current) {
          firstMoveEndRef.current = false;
          return;
        }
        if (!onViewChange) return;
        const { latitude, longitude, zoom: z } = evt.viewState;
        onViewChange({ latitude, longitude, zoom: z });
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={BASEMAP_STYLE[theme]}
      projection="globe"
      attributionControl={false}
    >
      <StackInteractions
        onPointClick={handlePinClick}
        onSpiderOpen={openSpider}
        onSpiderClose={closeSpider}
        onPinHover={hoverPin}
        spider={spider}
      />
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
        {/* Radius scales with point count */}
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
            // Ease the clustering-ceiling handoff: clusters thin out while
            // approaching the ceiling instead of vanishing at full opacity
            // (their unclustered replacements fade in from the same level).
            // Zoom-interpolated paint, so the GPU does the whole fade.
            "circle-opacity": [
              "interpolate", ["linear"], ["zoom"],
              14.5, 0.85,
              15, 0.35,
            ],
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
            // Skip symbol placement + its collision fade: a count must
            // appear and disappear with its circle, never linger alone
            // after the circle went (circles have no placement fade).
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            // Mirrors the cluster circle's ceiling fade above.
            "text-opacity": [
              "interpolate", ["linear"], ["zoom"],
              14.5, 1,
              15, 0.35,
            ],
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
            // The ceiling crossfade's other half: pins released by a
            // dissolving cluster materialize from its hand-off opacity. The
            // brief dip also touches always-visible lone pins right at the
            // boundary, which keeps the transition wave uniform.
            "circle-opacity": [
              "interpolate", ["linear"], ["zoom"],
              14.99, 1,
              15, 0.35,
              15.25, 1,
            ],
          }}
        />

        {/* Unclustered co-located stack: one counted badge, visually the
            same object as the small cluster it resolved from (same colour,
            radius, opacity, count text), so crossing the clustering ceiling
            never reads as a colour or shape change; only the hover behavior
            differs (a stack fans out, a cluster zooms). The selected halo
            moves onto the badge when it holds the selected event. */}
        <Layer
          id="stacks-circle"
          type="circle"
          filter={stackFilter}
          paint={{
            "circle-radius": 12,
            "circle-color": marker.base,
            // Stack members always cluster together below the ceiling, so a
            // badge only ever exists past it: fading in from the cluster's
            // hand-off opacity completes the crossfade started above.
            "circle-opacity": [
              "interpolate", ["linear"], ["zoom"],
              15, 0.35,
              15.25, 0.85,
            ],
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
            "text-opacity": [
              "interpolate", ["linear"], ["zoom"],
              15, 0.35,
              15.25, 1,
            ],
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
        x={preview.x}
        y={preview.y}
      />
    )}
    </div>
  );
}

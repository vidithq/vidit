"use client";

import { useEffect, useState } from "react";
import type { ErrorEvent, MapSourceDataEvent } from "maplibre-gl";
import { useMap } from "react-map-gl/maplibre";

import { cn } from "@/lib/cn";
import { WARNING_CALLOUT } from "@/components/ui/styles";

import { isOverlaySource } from "./basemap";

/** Whether a basemap source stopped answering: some of its tiles failed, and none loaded, between
 *  two moments the map came to rest. A tile that loads later clears it. Any basemap counts, since
 *  every one draws from an outside tile server. */
function useBasemapUnreachable(): boolean {
  const { current: map } = useMap();
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    if (!map) return;
    const raw = map.getMap();
    const failed = new Set<string>();
    const loaded = new Set<string>();
    const down = new Set<string>();
    const update = () => {
      for (const id of down) {
        const source = raw.getSource(id);
        if (!source || isOverlaySource(id, source.type)) down.delete(id);
      }
      setUnreachable(down.size > 0);
    };
    // A 404 raises no error: MapLibre reads it as a tile the source does not have.
    const onError = (event: ErrorEvent & { sourceId?: string }) => {
      if (event.sourceId) failed.add(event.sourceId);
    };
    const onData = (event: MapSourceDataEvent) => {
      if (event.tile) loaded.add(event.sourceId);
    };
    const onIdle = () => {
      for (const id of failed) if (!loaded.has(id)) down.add(id);
      for (const id of loaded) down.delete(id);
      failed.clear();
      loaded.clear();
      update();
    };
    raw.on("error", onError);
    raw.on("sourcedata", onData);
    raw.on("idle", onIdle);
    raw.on("styledata", update);
    return () => {
      raw.off("error", onError);
      raw.off("sourcedata", onData);
      raw.off("idle", onIdle);
      raw.off("styledata", update);
    };
  }, [map]);
  return unreachable;
}

/** A line over the map while its basemap's tile server does not answer, so a blank map says why.
 *  It takes no pointer event, so the map stays usable under it. */
export function BasemapFailureNotice() {
  const unreachable = useBasemapUnreachable();
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4"
    >
      {/* The opaque plate keeps the translucent callout readable over any basemap. */}
      {unreachable && (
        <p className="max-w-xs rounded-md bg-neutral-900 shadow-lg">
          <span className={cn("block rounded-md px-3 py-2 text-center text-sm", WARNING_CALLOUT)}>
            The basemap provider does not respond. Try another basemap, or reload later.
          </span>
        </p>
      )}
    </div>
  );
}

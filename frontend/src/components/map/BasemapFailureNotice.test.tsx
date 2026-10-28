import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BasemapFailureNotice } from "./BasemapFailureNotice";

type Handler = (event: Record<string, unknown>) => void;

/** The map events the notice reads, and the sources of the style on show by type. */
const map = {
  handlers: new Map<string, Set<Handler>>(),
  sources: new Map<string, string>(),
  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  },
  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
  },
  fire(event: string, data: Record<string, unknown> = {}) {
    act(() => this.handlers.get(event)?.forEach((handler) => handler(data)));
  },
  getSource(id: string) {
    const type = this.sources.get(id);
    return type ? { type } : undefined;
  },
};

vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({ current: { getMap: () => map } }),
}));

const NOTICE = /basemap provider does not respond/;

function tileFails(sourceId: string) {
  map.fire("error", { sourceId, tile: {}, error: new Error("Failed to fetch") });
}

function tileLoads(sourceId: string) {
  map.fire("sourcedata", { sourceId, tile: {}, dataType: "source" });
}

beforeEach(() => {
  map.handlers.clear();
  map.sources.clear();
  map.sources.set("s2cloudless-2016", "raster");
  render(<BasemapFailureNotice />);
});

describe("<BasemapFailureNotice>", () => {
  it("says the provider does not respond once the map rests with none of its tiles loaded", () => {
    tileFails("s2cloudless-2016");
    expect(screen.queryByText(NOTICE)).toBeNull();
    map.fire("idle");
    expect(screen.getByRole("status")).toHaveTextContent(NOTICE);
  });

  it("stays quiet while some tiles of the basemap still load", () => {
    tileFails("s2cloudless-2016");
    tileLoads("s2cloudless-2016");
    map.fire("idle");
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("leaves once a tile of the basemap loads again", () => {
    tileFails("s2cloudless-2016");
    map.fire("idle");
    tileLoads("s2cloudless-2016");
    map.fire("idle");
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("leaves when another basemap replaces the failing one", () => {
    tileFails("s2cloudless-2016");
    map.fire("idle");
    map.sources.delete("s2cloudless-2016");
    map.fire("styledata");
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("ignores an overlay that fails to load", () => {
    map.sources.set("fire-detections", "geojson");
    map.sources.set("gibs-true-colour", "raster");
    tileFails("fire-detections");
    tileFails("gibs-true-colour");
    map.fire("idle");
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});

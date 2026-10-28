import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SatelliteOverlays } from "./SatelliteOverlays";

type Handler = () => void;

/** The map calls the overlays make: sources by id, each loaded or not, and its events. */
const map = {
  handlers: new Map<string, Set<Handler>>(),
  sources: new Map<string, boolean>(),
  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  },
  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
  },
  fire(event: string) {
    act(() => this.handlers.get(event)?.forEach((handler) => handler()));
  },
  getSource(id: string) {
    return this.sources.has(id) ? {} : undefined;
  },
  isSourceLoaded(id: string) {
    return this.sources.get(id) ?? false;
  },
  getLayersOrder: () => [],
  getLayer: () => undefined,
  moveLayer: () => {},
};

vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({ current: { getMap: () => map } }),
  Source: () => null,
  Layer: () => null,
}));

let settle: { resolve: () => void; reject: () => void };
vi.mock("./gibs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gibs")>()),
  loadFireDetections: () =>
    new Promise((resolve, reject) => {
      settle = {
        resolve: () => resolve({ type: "FeatureCollection", features: [] }),
        reject: () => reject(new Error("GIBS fire detections: 503")),
      };
    }),
}));

beforeEach(() => {
  map.handlers.clear();
  map.sources.clear();
});

function mount(props: { imagery: boolean; fires: boolean }) {
  const onLoadingChange = vi.fn();
  const view = render(<SatelliteOverlays {...props} brightness="dark" onLoadingChange={onLoadingChange} />);
  return { onLoadingChange, view };
}

describe("<SatelliteOverlays> loading", () => {
  it("loads while the imagery tiles in view load, and stops once they are in", () => {
    const { onLoadingChange } = mount({ imagery: true, fires: false });
    map.sources.set("gibs-true-colour", false);
    map.fire("dataloading");
    expect(onLoadingChange).toHaveBeenLastCalledWith(true);
    map.sources.set("gibs-true-colour", true);
    map.fire("idle");
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });

  it("loads again when a move asks for new imagery tiles", () => {
    const { onLoadingChange } = mount({ imagery: true, fires: false });
    map.sources.set("gibs-true-colour", false);
    map.fire("moveend");
    expect(onLoadingChange).toHaveBeenLastCalledWith(true);
  });

  it("loads until the fire detections arrive and their source has them", async () => {
    const { onLoadingChange } = mount({ imagery: false, fires: true });
    expect(onLoadingChange).toHaveBeenLastCalledWith(true);
    map.sources.set("fire-detections", false);
    await act(async () => settle.resolve());
    map.fire("data");
    expect(onLoadingChange).toHaveBeenLastCalledWith(true);
    map.sources.set("fire-detections", true);
    map.fire("idle");
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });

  it("stops loading when the fire detections fail", async () => {
    const { onLoadingChange } = mount({ imagery: false, fires: true });
    expect(onLoadingChange).toHaveBeenLastCalledWith(true);
    await act(async () => settle.reject());
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });

  it("reports no loading once the overlays unmount", () => {
    const { onLoadingChange, view } = mount({ imagery: true, fires: false });
    map.sources.set("gibs-true-colour", false);
    map.fire("dataloading");
    view.unmount();
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });
});

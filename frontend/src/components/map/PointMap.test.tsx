import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No map in jsdom: the stub records its props and mounts its children; the map is a fake that
// keeps its listeners, so a test fires MapLibre's events by hand.
const mapProps = vi.fn();
vi.mock("./Map", () => ({
  default: ({ children, ...props }: { children?: ReactNode }) => {
    mapProps(props);
    return <div data-testid="map">{children}</div>;
  },
}));

type Listener = (e: unknown) => void;
let listeners: { type: string; layers: unknown; fn: Listener }[] = [];
const canvas = document.createElement("canvas");
let onPin = false;
const fakeMap = {
  getCanvas: () => canvas,
  getLayer: () => ({}),
  queryRenderedFeatures: () => (onPin ? [{}] : []),
  on: (type: string, a: unknown, b?: Listener) =>
    listeners.push(b ? { type, layers: a, fn: b } : { type, layers: null, fn: a as Listener }),
  off: (type: string, a: unknown, b?: Listener) => {
    const fn = b ?? a;
    listeners = listeners.filter((l) => !(l.type === type && l.fn === fn));
  },
};
vi.mock("react-map-gl/maplibre", () => ({ useMap: () => ({ current: fakeMap }) }));

import PointMap from "./PointMap";

/** Fires `type` as MapLibre would: on the map, or on the pin's layers with `onLayer`. */
function fire(type: string, { lat = 0, lng = 0, onLayer = false } = {}) {
  let prevented = false;
  const event = {
    type,
    point: { x: 1, y: 1 },
    lngLat: { wrap: () => ({ lat, lng }) },
    originalEvent: { preventDefault: () => {} },
    preventDefault: () => {
      prevented = true;
    },
  };
  for (const l of listeners.filter((l) => l.type === type && (l.layers !== null) === onLayer)) {
    l.fn(event);
  }
  return prevented;
}

beforeEach(() => {
  listeners = [];
  onPin = false;
  mapProps.mockClear();
});

describe("<PointMap>", () => {
  it("draws the point as the one pin, the event's own on its page", () => {
    render(<PointMap point={{ lat: 48.5, lng: 37.8 }} id="e1" detected />);
    expect(mapProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        points: [["e1", 48.5, 37.8, "", "", 1]],
        center: { lat: 48.5, lng: 37.8 },
        zoom: 12,
        pinPreview: true,
        embedded: true,
      }),
    );
    expect(listeners).toEqual([]);
  });

  it("shows the map without a pin while there is no point", () => {
    render(<PointMap point={null} onPick={() => {}} />);
    expect(mapProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ points: [], center: undefined, pinPreview: false }),
    );
  });

  it("moves the pin where the map is clicked, but not on a click on the pin itself", () => {
    const onPick = vi.fn();
    render(<PointMap point={{ lat: 48.5, lng: 37.8 }} onPick={onPick} />);
    fire("click", { lat: 48.6, lng: 37.9 });
    expect(onPick).toHaveBeenCalledWith({ lat: 48.6, lng: 37.9 });

    onPick.mockClear();
    onPin = true;
    fire("click", { lat: 48.6, lng: 37.9 });
    expect(onPick).not.toHaveBeenCalled();
  });

  it("drags the pin, holding the map's own pan, until the button is released", () => {
    const onPick = vi.fn();
    render(<PointMap point={{ lat: 48.5, lng: 37.8 }} onPick={onPick} />);
    fire("mousemove", { lat: 1, lng: 1 });
    expect(onPick).not.toHaveBeenCalled();

    expect(fire("mousedown", { onLayer: true })).toBe(true);
    expect(canvas.style.cursor).toBe("grabbing");
    fire("mousemove", { lat: 48.51, lng: 37.81 });
    fire("mousemove", { lat: 48.52, lng: 37.82 });
    expect(onPick.mock.calls).toEqual([
      [{ lat: 48.51, lng: 37.81 }],
      [{ lat: 48.52, lng: 37.82 }],
    ]);

    fire("mouseup");
    fire("mousemove", { lat: 2, lng: 2 });
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(canvas.style.cursor).toBe("");
  });

  it("drags the pin under one finger", () => {
    const onPick = vi.fn();
    render(<PointMap point={{ lat: 48.5, lng: 37.8 }} onPick={onPick} />);
    fire("touchstart", { onLayer: true });
    fire("touchmove", { lat: 48.53, lng: 37.83 });
    fire("touchend");
    expect(onPick).toHaveBeenCalledWith({ lat: 48.53, lng: 37.83 });
  });
});

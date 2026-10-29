import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The map is a fake that keeps its listeners, so a test fires MapLibre's events by hand.
type Listener = (e: unknown) => void;
let listeners: { type: string; onLayer: boolean; fn: Listener }[] = [];
const canvas = document.createElement("canvas");
const fakeMap = {
  getCanvas: () => canvas,
  on: (type: string, a: unknown, b?: Listener) =>
    listeners.push(b ? { type, onLayer: true, fn: b } : { type, onLayer: false, fn: a as Listener }),
  off: (type: string, a: unknown, b?: Listener) => {
    const fn = b ?? a;
    listeners = listeners.filter((l) => !(l.type === type && l.fn === fn));
  },
};
vi.mock("react-map-gl/maplibre", () => ({ useMap: () => ({ current: fakeMap }) }));

import { useLayerDrag, type LayerDrag } from "./useLayerDrag";

const LAYERS = ["handles"];

function Harness(props: LayerDrag) {
  useLayerDrag(LAYERS, props);
  return null;
}

/** Fires `type` as MapLibre would, on the map or on the layers with `onLayer`, and reports which
 *  defaults it held: the map's own gesture, and the page's under it. */
function fire(type: string, { onLayer = false, fingers = 1 } = {}) {
  const held = { map: false, page: false };
  const event = {
    type,
    ...(type.startsWith("touch") ? { points: Array.from({ length: fingers }, () => ({})) } : {}),
    originalEvent: {
      preventDefault: () => {
        held.page = true;
      },
    },
    preventDefault: () => {
      held.map = true;
    },
  };
  for (const l of listeners.filter((l) => l.type === type && l.onLayer === onLayer)) l.fn(event);
  return held;
}

beforeEach(() => {
  listeners = [];
  canvas.style.cursor = "";
});

describe("useLayerDrag", () => {
  it("drags under one finger, holding the map's pan and the page's scroll, until it lifts", () => {
    const drag = vi.fn();
    render(<Harness grab={() => true} drag={drag} />);

    expect(fire("touchstart", { onLayer: true }).map).toBe(true);
    expect(canvas.style.cursor).toBe("grabbing");
    expect(fire("touchmove").page).toBe(true);
    expect(drag).toHaveBeenCalledTimes(1);

    fire("touchend");
    expect(fire("touchmove").page).toBe(false);
    expect(drag).toHaveBeenCalledTimes(1);
    expect(canvas.style.cursor).toBe("");
  });

  it("leaves a two-finger gesture to the map", () => {
    const grab = vi.fn(() => true);
    const drag = vi.fn();
    render(<Harness grab={grab} drag={drag} />);

    expect(fire("touchstart", { onLayer: true, fingers: 2 }).map).toBe(false);
    expect(fire("touchmove", { fingers: 2 }).page).toBe(false);
    expect(grab).not.toHaveBeenCalled();
    expect(drag).not.toHaveBeenCalled();
  });

  it("leaves a press the caller refuses to the map", () => {
    const drag = vi.fn();
    render(<Harness grab={() => false} drag={drag} canGrab={() => false} />);

    fire("mouseenter", { onLayer: true });
    expect(canvas.style.cursor).toBe("");
    expect(fire("touchstart", { onLayer: true }).map).toBe(false);
    fire("touchmove");
    expect(drag).not.toHaveBeenCalled();
  });

  it("calls the latest handlers, keeping the drag under way across renders", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness grab={() => true} drag={first} />);
    fire("mousedown", { onLayer: true });
    rerender(<Harness grab={() => true} drag={second} />);
    fire("mousemove");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

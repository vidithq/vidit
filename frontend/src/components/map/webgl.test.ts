import { afterEach, describe, expect, it, vi } from "vitest";
import { guardedMaplibre, supportsMaplibreWebGL, WebGLUnavailableError } from "./webgl";

function stubContexts(contexts: Record<string, unknown>) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    ((kind: string) => contexts[kind] ?? null) as typeof HTMLCanvasElement.prototype.getContext
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("supportsMaplibreWebGL", () => {
  it("rejects a browser that offers WebGL1 only", () => {
    stubContexts({ webgl: {} });
    expect(supportsMaplibreWebGL()).toBe(false);
  });

  it("accepts WebGL2 and releases the probe context", () => {
    const loseContext = vi.fn();
    stubContexts({ webgl2: { getExtension: () => ({ loseContext }) } });
    expect(supportsMaplibreWebGL()).toBe(true);
    expect(loseContext).toHaveBeenCalledOnce();
  });
});

describe("guardedMaplibre.Map", () => {
  it("throws when MapLibre cannot create its painter", () => {
    stubContexts({});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    expect(
      () => new guardedMaplibre.Map({ container, style: { version: 8, sources: {}, layers: [] } })
    ).toThrow(WebGLUnavailableError);
  });
});

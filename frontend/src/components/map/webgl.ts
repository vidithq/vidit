import * as maplibregl from "maplibre-gl";
import type { MapLib } from "react-map-gl/maplibre";

// The context MapLibre requests in `Map._setupPainter`: WebGL2 only, with these buffers forced on.
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  depth: true,
  stencil: true,
  premultipliedAlpha: true,
};

export class WebGLUnavailableError extends Error {
  constructor() {
    super("MapLibre could not create a WebGL2 context");
    this.name = "WebGLUnavailableError";
  }
}

/** Whether this browser can create the context MapLibre needs. The probe context is released at
 * once because browsers cap the number of live WebGL contexts. */
export function supportsMaplibreWebGL(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2", CONTEXT_ATTRIBUTES);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

// MapLibre reports a failed context by firing `error` from inside its constructor, before
// react-map-gl attaches `onError`, and returns a map with no painter whose `getBounds()` and
// `remove()` throw. Throwing instead routes the failure to `onError` and leaves no map to remove.
class GuardedMap extends maplibregl.Map {
  constructor(options: maplibregl.MapOptions) {
    super(options);
    if (!this.painter) throw new WebGLUnavailableError();
  }
}

export const guardedMaplibre = { ...maplibregl, Map: GuardedMap } as unknown as MapLib;

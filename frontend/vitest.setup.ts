import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements neither observer API. Both are layout-driven, and jsdom does
// no layout, so a stub that never fires is the honest stand-in: it lets a
// component that wires one up mount (the video player observes its own size and
// visibility) without pretending anything came into view or changed size.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: readonly number[] = [];
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??=
  NoopObserver as unknown as typeof IntersectionObserver;

// jsdom hands back a plain array for a media element's track lists instead of
// the live `EventTarget` the spec defines, so anything subscribing to track
// changes throws on `addEventListener`. The video player's controller
// subscribes on mount. An empty list that can be listened to is the honest
// stand-in: jsdom decodes no media, so no track ever appears in it.
class EmptyTrackList extends EventTarget {
  readonly length = 0;
  getTrackById() {
    return null;
  }
  [Symbol.iterator]() {
    return [][Symbol.iterator]();
  }
}
const trackLists = new WeakMap<object, Map<string, EmptyTrackList>>();
for (const name of ["textTracks", "audioTracks", "videoTracks"]) {
  Object.defineProperty(HTMLMediaElement.prototype, name, {
    configurable: true,
    get(this: object) {
      let lists = trackLists.get(this);
      if (!lists) trackLists.set(this, (lists = new Map()));
      let list = lists.get(name);
      if (!list) lists.set(name, (list = new EmptyTrackList()));
      return list;
    },
  });
}

// jsdom builds no CSSOM for a `<style>` inside a shadow root (`style.sheet`
// stays null), so every media-chrome control warns while mounting that it
// cannot reach its own rules. Styling is out of reach in a layout-less DOM
// anyway, so that one warning is dropped to keep a run readable; every other
// warning still prints.
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (
    typeof args[0] === "string" &&
    args[0].startsWith("Media Chrome: No style sheet found")
  ) {
    return;
  }
  warn(...args);
};

// jsdom implements no media queries: `matchMedia` is one of its documented
// gaps, not something it answers falsely. Every query reports unmatched here,
// which is the neutral answer: no reduced motion, no coarse pointer, no dark
// system preference.
//
// Load-bearing, and not only for components that query it themselves:
// media-chrome probes `globalThis.matchMedia` for PiP support at *import*
// time, so without this every module reaching `VideoPlayer` throws before a
// single test runs. Deleting it fails ten suites.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

// The runner's jsdom exposes no `localStorage`: Node ships its own global,
// which stays `undefined` unless the process is started with
// `--localstorage-file`, and it shadows jsdom's on the shared `globalThis`.
// Anything touching the store then throws, whether it reads `window.localStorage`
// (the display-preference libs, and their tests) or the bare global, so the
// environment gets a minimal in-memory `Storage` instead.
if (!globalThis.localStorage) {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

// Testing Library's automatic between-test cleanup registers on a global
// `afterEach`, which only exists under vitest's `globals: true` — hook it
// explicitly so renders never leak across tests.
afterEach(cleanup);

import { getVersion, setWorkerUrl } from "maplibre-gl";

// maplibre-gl resolves its worker from a runtime-computed URL the bundler
// never sees, so the default request 404s and no tile or pin renders.
// `scripts/copy-maplibre-worker.mjs` (run from next.config.mjs) serves the
// worker from `public/` at this path; it has to be set before the first map
// is created, which importing this module from Map.tsx guarantees.
setWorkerUrl(`/maplibre-gl/${getVersion()}/maplibre-gl-worker.mjs`);

import { getVersion, setWorkerUrl } from "maplibre-gl";

// maplibre-gl resolves its worker from a URL the bundler never sees, so the default request 404s.
// `scripts/copy-maplibre-worker.mjs` (run from next.config.mjs) serves it from `public/`; set before
// the first map, which importing this module from Map.tsx guarantees.
setWorkerUrl(`/maplibre-gl/${getVersion()}/maplibre-gl-worker.mjs`);

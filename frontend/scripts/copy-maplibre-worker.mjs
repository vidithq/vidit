import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the maplibre-gl web worker into `public/maplibre-gl/<version>/`.
 *
 * maplibre-gl builds its worker URL at runtime from a computed string, which
 * the bundler cannot see, and the worker imports `./maplibre-gl-shared.mjs`
 * by its unhashed name. Serving both files side by side from `public/` keeps
 * that relative import working. `components/map/maplibreWorker.ts` points
 * `setWorkerUrl` at the same path, keyed on `getVersion()`, so a version bump
 * changes the URL and no browser keeps a stale worker.
 */
export function copyMaplibreWorker() {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("maplibre-gl/package.json");
  const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
  const dist = join(dirname(pkgPath), "dist");
  const root = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "public",
    "maplibre-gl",
  );
  rmSync(root, { recursive: true, force: true });
  const target = join(root, version);
  mkdirSync(target, { recursive: true });
  for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
    copyFileSync(join(dist, file), join(target, file));
  }
}

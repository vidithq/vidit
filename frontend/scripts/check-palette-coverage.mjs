// Fails if a shared primitive (components/ui/*) or a style constant
// (styles.ts / form-styles.ts) is not named in the /palette styleguide, which
// spans every .tsx file under src/app/palette/ (the page and its category files).
//
// Keeps /palette a *verified, exhaustive* contract: as the catalogue grows, the
// styleguide can't silently fall out of date, so palette coherence is the one
// thing a human has to watch (see AGENTS.md -> "Palette-first"). Blunt on
// purpose: it asserts the name is present, not how well it's demoed.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const frontend = join(dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = join(frontend, "src/components/ui");
const paletteDir = join(frontend, "src/app/palette");
const palette = readdirSync(paletteDir, { recursive: true })
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => readFileSync(join(paletteDir, f), "utf8"))
  .join("\n");

const names = new Set();

// One primitive per component file. Siblings exported from the same file
// (DetailCard in DetailRow.tsx, PageError in PageShell.tsx, ...) are documented
// alongside it, so the filename is the unit of coverage.
for (const f of readdirSync(uiDir)) {
  if (f.endsWith(".tsx") && !f.endsWith(".test.tsx")) {
    names.add(f.replace(/\.tsx$/, ""));
  }
}

// Every exported style + form constant.
for (const file of ["styles.ts", "form-styles.ts"]) {
  const src = readFileSync(join(uiDir, file), "utf8");
  for (const m of src.matchAll(/export const ([A-Z0-9_]+)/g)) names.add(m[1]);
}

const missing = [...names]
  .filter((n) => !new RegExp(`\\b${n}\\b`).test(palette))
  .sort();

if (missing.length) {
  console.error(
    "✖ Not documented in /palette (no .tsx file under src/app/palette/ names it):",
  );
  for (const n of missing) console.error("  - " + n);
  console.error(
    "\nAdd an entry with a live demo to the category file it belongs to, then re-run.",
  );
  console.error("See AGENTS.md → Palette-first.");
  process.exit(1);
}

console.log(
  `✓ /palette documents all ${names.size} primitives + constants.`,
);

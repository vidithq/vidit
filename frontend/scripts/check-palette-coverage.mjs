// /palette shows the components screens use as they are. A shared primitive (a components/ui
// file) or a style constant (styles.ts / form-styles.ts) that a page in app/ or a component
// outside components/ui imports must head a /palette entry (`entry: "..."` in a file under
// src/app/palette/). One that only other components/ui files import must not: the demo of the
// component that holds it shows it. See AGENTS.md -> "Palette-first".
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const frontend = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(frontend, "src");
const uiDir = join(src, "components/ui");
const paletteDir = join(src, "app/palette");

// The files whose imports put a primitive on a screen: not the primitives themselves, the
// palette, the test helpers or the tests.
const consumers = readdirSync(src, { recursive: true })
  .map((f) => f.split(sep).join("/"))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .filter((f) => !/^(components\/ui|app\/palette|test)\//.test(f))
  .map((f) => join(src, f));

const entryNames = readdirSync(paletteDir, { recursive: true })
  .filter((f) => f.endsWith(".tsx"))
  .flatMap((f) => [...readFileSync(join(paletteDir, f), "utf8").matchAll(/\bentry:\s*"([^"]+)"/g)])
  .map((m) => m[1])
  .join("\n");

const named = (name) => new RegExp(`\\b${name}\\b`).test(entryNames);

// What the consumers import from components/ui, by module and by name; `import type` puts
// nothing on a screen.
const importedModules = new Set();
const importedNames = new Set();
for (const file of consumers) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/^import (?!type\b)([^;]*?) from "@\/components\/ui\/([\w-]+)";/gms)) {
    const names = m[1]
      .replace(/[{}]/g, "")
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith("type "))
      .map((n) => n.replace(/\s+as\s+\w+$/, ""));
    if (names.length === 0) continue;
    importedModules.add(m[2]);
    for (const name of names) importedNames.add(`${m[2]}:${name}`);
  }
}

const required = [];
const forbidden = [];

// One primitive per component file: its siblings (DetailCard in DetailRow.tsx, PageError in
// PageShell.tsx) show in its entry.
for (const f of readdirSync(uiDir)) {
  if (!f.endsWith(".tsx") || f.endsWith(".test.tsx")) continue;
  const name = f.replace(/\.tsx$/, "");
  (importedModules.has(name) ? required : forbidden).push(name);
}

for (const file of ["styles", "form-styles"]) {
  const text = readFileSync(join(uiDir, `${file}.ts`), "utf8");
  for (const m of text.matchAll(/export const ([A-Z0-9_]+)/g)) {
    (importedNames.has(`${file}:${m[1]}`) ? required : forbidden).push(m[1]);
  }
}

const missing = required.filter((n) => !named(n)).sort();
const extra = forbidden.filter((n) => named(n)).sort();

if (missing.length) {
  console.error("✖ Used by a screen but heads no /palette entry:");
  for (const n of missing) console.error("  - " + n);
  console.error("Add an entry with a live demo to its category file under src/app/palette/.");
}
if (extra.length) {
  console.error("✖ Used only inside other components/ui files, yet heads a /palette entry:");
  for (const n of extra) console.error("  - " + n);
  console.error("Remove the entry: the demo of the component that holds it shows it.");
}
if (missing.length || extra.length) {
  console.error("See AGENTS.md → Palette-first.");
  process.exit(1);
}

console.log(
  `✓ /palette heads an entry for the ${required.length} primitives and constants screens use, and none for the ${forbidden.length} used only inside primitives.`,
);

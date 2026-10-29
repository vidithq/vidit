// /palette and components/ui follow the import graph. A components/ui file or a style constant
// (styles.ts / form-styles.ts) is:
// - low level when two or more other components/ui files reuse it, whatever else imports it;
// - high level when a surface (a page in app/ or a component outside components/ui) uses it and
//   at most one other components/ui file reuses it;
// - not a shared primitive when exactly one components/ui file imports it and no surface does:
//   fold it into that file.
// Every high or low level one heads a /palette entry (`entry: "...", tier: "high" | "low"`) of
// its tier. See AGENTS.md -> "Palette-first".
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";

const frontend = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(frontend, "src");
const uiDir = join(src, "components/ui");
const paletteDir = join(src, "app/palette");

// Every importer but the palette, the test helpers and the tests.
const importers = readdirSync(src, { recursive: true })
  .map((f) => f.split(sep).join("/"))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !/^(app\/palette|test)\//.test(f));

// Module -> the files that import it, and module:name -> the files that import that name.
// `import type` puts nothing on a screen.
const byModule = new Map();
const byName = new Map();
const add = (map, key, file) => map.set(key, (map.get(key) ?? new Set()).add(file));
for (const file of importers) {
  const text = readFileSync(join(src, file), "utf8");
  const fromUi = file.startsWith("components/ui/");
  for (const m of text.matchAll(/^import (?!type\b)([^;]*?) from "([^"]+)";/gms)) {
    const spec = m[2];
    const mod = spec.startsWith("@/components/ui/")
      ? spec.slice("@/components/ui/".length)
      : fromUi && spec.startsWith("./")
        ? spec.slice(2)
        : null;
    if (!mod || mod.includes("/")) continue;
    const names = m[1]
      .replace(/[{}]/g, "")
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith("type "))
      .map((n) => n.replace(/\s+as\s+\w+$/, ""));
    if (names.length === 0) continue;
    add(byModule, mod, file);
    for (const name of names) add(byName, `${mod}:${name}`, file);
  }
}

const tierOf = (users) => {
  const files = [...(users ?? [])];
  const ui = files.filter((f) => f.startsWith("components/ui/"));
  if (ui.length > 1) return "low";
  if (files.length > ui.length) return "high";
  return ui.length === 1 ? `fold:${ui[0]}` : null;
};

const shared = [];
for (const f of readdirSync(uiDir)) {
  if (!f.endsWith(".tsx") || f.endsWith(".test.tsx")) continue;
  const name = f.replace(/\.tsx$/, "");
  shared.push([name, tierOf(byModule.get(name))]);
}
for (const file of ["styles", "form-styles"]) {
  const text = readFileSync(join(uiDir, `${file}.ts`), "utf8");
  for (const m of text.matchAll(/export const ([A-Z0-9_]+)/g)) {
    shared.push([m[1], tierOf(byName.get(`${file}:${m[1]}`))]);
  }
}

// Each palette entry with the tier it declares.
const entries = [];
for (const f of readdirSync(paletteDir, { recursive: true })) {
  if (!f.endsWith(".tsx")) continue;
  for (const m of readFileSync(join(paletteDir, f), "utf8").matchAll(/\bentry:\s*"([^"]+)"(?:,\s*tier:\s*"(high|low)")?/g)) {
    entries.push({ name: m[1], tier: m[2] ?? null, file: f });
  }
}
const entryOf = (name) => entries.find((e) => new RegExp(`\\b${name}\\b`).test(e.name));

const errors = [];
for (const [name, tier] of shared) {
  const entry = entryOf(name);
  if (tier?.startsWith("fold:")) {
    errors.push(`${name}: only ${tier.slice(5)} imports it; fold it into that file`);
  } else if (tier && !entry) {
    errors.push(`${name}: ${tier} level, but heads no /palette entry`);
  } else if (tier && entry.tier !== tier) {
    errors.push(`${name}: ${tier} level, but its entry says ${entry.tier ?? "no tier"} (${entry.file})`);
  } else if (!tier && entry) {
    errors.push(`${name}: nothing imports it, yet it heads a /palette entry`);
  }
}

if (errors.length) {
  console.error("✖ /palette and components/ui disagree with the import graph:");
  for (const e of errors.sort()) console.error("  - " + e);
  console.error("See AGENTS.md → Palette-first.");
  process.exit(1);
}

const count = (t) => shared.filter(([, tier]) => tier === t).length;
console.log(`✓ /palette matches the import graph: ${count("high")} high level, ${count("low")} low level.`);

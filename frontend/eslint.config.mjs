// ESLint flat config — the v9+ replacement for `.eslintrc.json`.
//
// `eslint-config-next` from v16 onwards ships as a first-class flat
// config array exported from `eslint-config-next/core-web-vitals`,
// so we import it directly. The `FlatCompat` bridge used during the
// 15.x → 16 transition is no longer needed (and chokes on the v16
// preset, which now reaches its plugins through a circular ref the
// legacy validator can't `JSON.stringify`).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  // Top-level ignores. Mirrors the implicit exclusions that
  // `next lint` used to apply (the script swapped to `eslint .` in
  // the migration, so we re-declare them here). `.next/` and `out/`
  // are build artefacts; `node_modules/` is third-party;
  // `tsconfig.tsbuildinfo` is TypeScript's incremental-build cache
  // and lints as JSON-with-a-quirk that ESLint chokes on.
  {
    ignores: [
      ".next/",
      "out/",
      "node_modules/",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
  ...nextCoreWebVitals,
  {
    // Downgrade `react-hooks/set-state-in-effect` from error to warning.
    // The Next 16 preset adds this rule as an error; it flags ~15 useEffect
    // sites that set state inside the effect (auth gating, data-load
    // bootstrap, etc.) — all idiomatic React 18 patterns. Refactoring them
    // to compute-at-render or move-to-event-handler is meaningful work and
    // doesn't belong in the same PR as the framework bump. Tracked in
    // planning/next.md → Refactors.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;

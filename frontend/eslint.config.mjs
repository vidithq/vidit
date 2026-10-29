// ESLint flat config — the v9+ replacement for `.eslintrc.json`.
//
// `eslint-config-next` from v16 onwards ships as a first-class flat
// config array exported from `eslint-config-next/core-web-vitals`,
// so we import it directly. The `FlatCompat` bridge used during the
// 15.x → 16 transition is no longer needed (and chokes on the v16
// preset, which now reaches its plugins through a circular ref the
// legacy validator can't `JSON.stringify`).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// A removal draws one of two icons, both from `ACTION_ICONS` in components/ui/Button.tsx: `remove`
// (a cross, minor, acts at once) or `delete` (a trash, important, behind <ConfirmButton>). Any
// other file that imports a cross, a trash or a look-alike from lucide-react fails the lint.
const REMOVAL_ICONS = [
  "Ban",
  "CircleMinus",
  "CircleSlash",
  "CircleSlash2",
  "CircleX",
  "Eraser",
  "MinusCircle",
  "SquareX",
  "Trash",
  "Trash2",
  "UserX",
  "X",
  "XCircle",
  "XSquare",
];

const restrictRemovalIcons = (names, message) => ({
  "no-restricted-imports": [
    "error",
    {
      paths: [
        {
          name: "lucide-react",
          importNames: names.flatMap((n) => [n, `${n}Icon`, `Lucide${n}`]),
          message,
        },
      ],
    },
  ],
});

const REMOVAL_MESSAGE =
  "A removal takes ACTION_ICONS.remove (a cross that acts at once) or ACTION_ICONS.delete (a trash behind <ConfirmButton>). See docs/design.md, Destructive actions.";

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
    // issue #475.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  { rules: restrictRemovalIcons(REMOVAL_ICONS, REMOVAL_MESSAGE) },
  {
    // The cross where it closes or marks a state and removes nothing: the drawer's and the
    // lightbox's close, the session notice's dismiss, a failed step, the closed status badge.
    files: [
      "src/components/Sidebar.tsx",
      "src/components/SessionEndedNotice.tsx",
      "src/components/ui/MediaLightbox.tsx",
      "src/components/ui/ProgressSteps.tsx",
      "src/components/event/StatusBadge.tsx",
    ],
    rules: restrictRemovalIcons(
      REMOVAL_ICONS.filter((n) => n !== "X"),
      REMOVAL_MESSAGE,
    ),
  },
  {
    // The one home of the removal icons.
    files: ["src/components/ui/Button.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;

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

// Primitives that left the codebase for the one primitive of their job (docs/design.md,
// Primitives by job): a module under one of these names comes back only through that table.
const RETIRED_PRIMITIVES = {
  "@/components/ui/AccountPicker": "Search an account with <ItemSearch>.",
  "@/components/ui/OptionPicker": "Pick from a vocabulary with <OptionSearch>.",
  "@/components/ui/ChipBucket": "Pick from a vocabulary with <OptionSearch>.",
  "@/components/ui/Disclosure": "Collapse a section with the <SectionEyebrow> toggle.",
};

const restrictRemovalIcons = (names, message) => ({
  "no-restricted-imports": [
    "error",
    {
      paths: [
        ...(names.length > 0
          ? [
              {
                name: "lucide-react",
                importNames: names.flatMap((n) => [n, `${n}Icon`, `Lucide${n}`]),
                message,
              },
            ]
          : []),
        ...Object.entries(RETIRED_PRIMITIVES).map(([name, message]) => ({ name, message })),
      ],
    },
  ],
});

// A raw element that would bypass the one primitive of its job. Input.tsx owns the native
// fields the primitives wrap.
const RAW_FIELDS = {
  "no-restricted-syntax": [
    "error",
    {
      selector: "JSXOpeningElement[name.name='select']",
      message: "Pick from a vocabulary with <OptionSearch>; a position in a list the form holds takes <Select>.",
    },
    {
      selector: "JSXOpeningElement[name.name='textarea']",
      message: "Use <Textarea> from components/ui/Input.tsx.",
    },
    {
      selector:
        "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value=/^(date|time|datetime-local|month|week)$/]",
      message: "Enter a date, a time or an instant with <DateTimeInput>.",
    },
    {
      selector: "CallExpression[callee.name='confirm'], CallExpression[callee.property.name='confirm'][callee.object.name='window']",
      message: "Confirm a destructive action with <ConfirmButton>, or <ConfirmDialog> when it needs input.",
    },
  ],
};

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
  { rules: { ...restrictRemovalIcons(REMOVAL_ICONS, REMOVAL_MESSAGE), ...RAW_FIELDS } },
  {
    // The cross where it closes or marks a state and removes nothing: the drawer's and the
    // lightbox's close, a failed step, the closed status badge.
    files: [
      "src/components/Sidebar.tsx",
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
    rules: restrictRemovalIcons([], REMOVAL_MESSAGE),
  },
  {
    // The one home of the native fields, and the test stubs that stand in for an editor.
    files: ["src/components/ui/Input.tsx", "src/test/**"],
    rules: { "no-restricted-syntax": "off" },
  },
];

export default config;

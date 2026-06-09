// ESLint flat config — the v9+ replacement for `.eslintrc.json`. v9 made
// flat the default (legacy mode was opt-in), v10 dropped legacy mode
// entirely. This shape is what the Next 15 codemod
// (`npx @next/codemod@canary next-lint-to-eslint-cli .`) produces.
//
// `eslint-config-next` from Next 15 onwards ships as a legacy-shape
// preset; `FlatCompat` from `@eslint/eslintrc` bridges it into flat
// config without us re-declaring every rule the preset enables. When
// `eslint-config-next` ships a first-class flat export this file can
// drop the `FlatCompat` import and switch to a direct import — until
// then, this is the stable path.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  // Top-level ignores. Mirrors the implicit exclusions that
  // `next lint` used to apply (the script swapped to `eslint .` in
  // the migration, so we re-declare them here). `.next/` and
  // `out/` are build artefacts; `node_modules/` is third-party;
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
  ...compat.extends("next/core-web-vitals"),
];

export default config;

import { execSync } from "node:child_process";

import { withSentryConfig } from "@sentry/nextjs";

/**
 * Build-time version string baked into NEXT_PUBLIC_BUILD_VERSION so the
 * "Closed beta · v..." badge can show the actually deployed ref.
 *
 * Resolution order:
 *  1. NEXT_PUBLIC_BUILD_VERSION already set in the env (the deploy workflow
 *     passes it explicitly so the value is auditable in run logs).
 *  2. `git describe --tags --always --dirty` — picks up the closest tag and
 *     the commits-past-tag suffix when not exactly on a tag. Requires
 *     fetch-depth: 0 in CI (set in .github/workflows/deploy.yml).
 *  3. "dev" — final fallback so an env without git history still builds.
 *     The badge renders this verbatim (no "v" prefix).
 */
function resolveBuildVersion() {
  if (process.env.NEXT_PUBLIC_BUILD_VERSION) {
    return process.env.NEXT_PUBLIC_BUILD_VERSION;
  }
  try {
    return execSync("git describe --tags --always --dirty", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

const buildVersion = resolveBuildVersion();

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_VERSION: buildVersion,
  },
  // Force-include the Montserrat .ttf in the Vercel function bundle for the
  // generated icon / apple-icon / manifest routes. The Satori renderer in
  // `src/app/icon.tsx` + `src/app/apple-icon.tsx` reads the .ttf at module
  // load via `readFileSync(join(process.cwd(), …))`, which Vercel's
  // node-file-trace can't resolve statically — without this hint the font
  // is missing in `/var/task` and every `/icon/*` route 500s with
  // `ENOENT: Montserrat-700.ttf`. The 500 cascades into a Server
  // Components render error on any page that pulls the manifest (which is
  // every page), so this hint isn't optional.
  experimental: {
    // Required on Next.js 14.x to enable the top-level `instrumentation.ts`
    // hook that boots the Sentry server / edge SDKs. Stable (no flag) from
    // Next.js 15 onwards — drop this line on the upgrade.
    instrumentationHook: true,
    // Next.js bundles `app/icon.tsx` into EVERY page's bundle for the
    // metadata-icon resolution pipeline (`d.metadata.icon`), not just
    // into the `/icon/*` route bundles. Static pages resolve their
    // metadata at build time (where the .ttf is on disk in the build
    // container, so things work), but **dynamic** pages re-execute
    // the icon module at request time on the Vercel function — which
    // means every dynamic page that didn't have the .ttf traced into
    // its bundle 500s with `ENOENT: ... Montserrat-700.ttf` from
    // `readFileSync` at module load.
    //
    // The glob `**` matches every entry, so the font travels with
    // every function bundle. ~30 KB per function — acceptable. The
    // alternative (enumerating each dynamic route) is brittle: every
    // new `[id]`-style page would have to remember to add itself
    // here or quietly start 500'ing in prod while passing local
    // tests (the bug stays local-invisible because `process.cwd()`
    // resolves to the on-disk tree during `npm run dev`).
    outputFileTracingIncludes: {
      "**": ["./src/app/Montserrat-700.ttf"],
    },
  },
  // Tightly-scoped allowlist for `next/image`. Only the hosts we actually
  // serve media from belong here — third-party hosts (picsum, unpkg, user
  // avatar URLs from arbitrary domains, etc.) must stay outside the
  // optimizer and render as plain `<img>` instead.
  //
  // Production media lives behind the CloudFront distribution declared in
  // CLAUDE.md (`d10w3bld05vsky.cloudfront.net`). Local dev media is served
  // by the FastAPI backend's `/local-storage/...` route (see
  // `backend/app/services/storage.py::LocalStorage`).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "d10w3bld05vsky.cloudfront.net" },
      { protocol: "http", hostname: "localhost", port: "8000" },
    ],
  },
};

// `withSentryConfig` wraps `next build` to upload source maps to Sentry and
// auto-instruments the framework hooks. The plugin gracefully no-ops when
// `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` are unset — useful
// during local dev and the bootstrap phase before the Sentry project is
// created. `silent: !process.env.CI` keeps local builds quiet; CI prints the
// upload diagnostics so a misconfigured deploy is obvious in the run summary.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Don't expose source maps on the public CDN — Sentry needs them to
  // symbolicate, but anyone with curl shouldn't get them for free.
  hideSourceMaps: true,
});

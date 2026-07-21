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

/**
 * True when the backend this build talks to is local, i.e. when the
 * `localhost:8000` remotePattern below is the live media host. Next loads the
 * `.env*` files before evaluating this config, so NEXT_PUBLIC_API_URL is
 * already set here.
 */
function apiIsLocal() {
  try {
    const host = new URL(process.env.NEXT_PUBLIC_API_URL ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

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
  //
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
  // The glob `**` matches every entry, so the font travels with every
  // function bundle. ~30 KB per function — acceptable. The alternative
  // (enumerating each dynamic route) is brittle: every new `[id]`-style
  // page would have to remember to add itself here or quietly start
  // 500'ing in prod while passing local tests (the bug stays local-
  // invisible because `process.cwd()` resolves to the on-disk tree
  // during `npm run dev`).
  //
  // Promoted out of `experimental` in Next.js 15.
  outputFileTracingIncludes: {
    "**": ["./src/app/Montserrat-700.ttf"],
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
    // Next 16's optimizer resolves each upstream host and refuses to fetch when
    // it lands on a private / loopback IP (an SSRF guard), which returns 400 for
    // the `localhost:8000` dev-media host above even though it matches a
    // remotePattern. Re-allow local IPs exactly when the backend is local
    // (keyed off the API host, not NODE_ENV, so a local `next start` still gets
    // its images); against a deployed backend media is the public CloudFront
    // host and the guard stays on where it matters.
    dangerouslyAllowLocalIP: apiIsLocal(),
  },
  // Security response headers, applied to every route (the authenticated
  // /submit, /settings, /admin pages included). Defense-in-depth: these don't
  // replace input validation, they limit what a bug (or a compromised
  // dependency) can do to the browser.
  //
  // A full resource CSP (script-src / style-src / img-src, etc.) is a
  // deliberate follow-up, not included here: Next's inline bootstrap scripts,
  // the maplibre worker/blob usage in the map view, and Tiptap's proof editor
  // all need directives worked out carefully, and getting them wrong breaks
  // the app rather than just narrowing it. This only locks down framing.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            // Blocks the app from being rendered inside a frame/iframe on
            // another origin, closing off clickjacking (an attacker
            // overlaying invisible controls on top of the real UI).
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            // Stops the browser from guessing content types and executing,
            // say, an uploaded image as if it were HTML/JS (MIME-sniffing).
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            // Sends the full referrer only to same-origin requests, and only
            // the origin (no path/query) cross-origin, so URLs carrying
            // sensitive path segments or tokens don't leak to third parties.
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // frame-ancestors is the CSP-level equivalent of X-Frame-Options
            // and is respected by browsers that ignore the older header;
            // kept scoped to framing only, see the comment above.
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
        ],
      },
    ];
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

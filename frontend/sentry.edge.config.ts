// Edge-runtime Sentry init (Next.js middleware + any route handlers running
// on the edge). Loaded by `instrumentation.ts` when NEXT_RUNTIME === "edge".
// Same shape as `sentry.server.config.ts`; kept as a separate file because
// Vercel's edge runtime ships a different subset of Node APIs and Sentry's
// edge bundle is tree-shaken accordingly.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    sendDefaultPii: false,
  });
}

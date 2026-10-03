// Client-side Sentry init. Mirrors the backend opt-in pattern
// (`backend/app/main.py`): no DSN → no init → no PII leak, safe to leave unset
// for local dev and owner-only self-test. Turned on by setting
// `NEXT_PUBLIC_SENTRY_DSN` on Vercel.
import * as Sentry from "@sentry/nextjs";

import { SENTRY_DATA_COLLECTION } from "./sentry.data-collection";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0,
    ),
    // Never auto-attach IP, cookies, or identifying headers to events: the
    // analysts' session cookies stay out of a third-party error tracker.
    dataCollection: SENTRY_DATA_COLLECTION,
  });
}

// Surface client-side navigation (route transition) errors to Sentry.
// Without this re-export the Sentry SDK logs an ACTION REQUIRED warning on
// every build and silently misses transition errors at runtime.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

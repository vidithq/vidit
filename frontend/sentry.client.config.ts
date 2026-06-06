// Client-side Sentry init. Mirrors the backend opt-in pattern
// (`backend/app/main.py`): no DSN → no init → no PII leak, safe to leave unset
// for local dev and owner-only self-test. Turned on by setting
// `NEXT_PUBLIC_SENTRY_DSN` on Vercel.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0,
    ),
    // Match backend `send_default_pii=False` — never auto-attach IP / cookies
    // / headers to events. Closed-beta threat model: identity-known analysts,
    // and we don't want their session cookies leaking into a third-party
    // error tracker.
    sendDefaultPii: false,
  });
}

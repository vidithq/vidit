// Server-side Sentry init for the Node.js runtime (route handlers, server
// components, server actions). Loaded by `instrumentation.ts` when
// NEXT_RUNTIME === "nodejs". Mirrors the backend opt-in pattern; the server
// reads `SENTRY_DSN` (not the public one) so the value can stay out of the
// client bundle if the owner ever wants separate client / server projects.
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

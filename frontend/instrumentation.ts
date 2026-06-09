// Next.js instrumentation hook — fires once per runtime boot. Branches on
// `NEXT_RUNTIME` because the Node and Edge bundles of `@sentry/nextjs` are
// shipped separately and importing the wrong one tree-shakes incorrectly.
// The client bundle has its own entry (`instrumentation-client.ts`) that
// Next.js + `withSentryConfig` wire up automatically.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// `onRequestError` is Next.js 15+'s hook for errors thrown by *nested* React
// Server Components — the regular `app/error.tsx` boundary only catches
// errors in the leaf route's render, so a throw deep inside a nested RSC tree
// would surface to the user without ever reaching Sentry. The plain
// re-export shape is what `@sentry/nextjs` documents
// (https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#errors-from-nested-react-server-components).
export const onRequestError = Sentry.captureRequestError;

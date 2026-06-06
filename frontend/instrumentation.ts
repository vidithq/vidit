// Next.js instrumentation hook — fires once per runtime boot. Branches on
// `NEXT_RUNTIME` because the Node and Edge bundles of `@sentry/nextjs` are
// shipped separately and importing the wrong one tree-shakes incorrectly.
// The client bundle has its own entry (`sentry.client.config.ts`) that
// Next.js + `withSentryConfig` wire up automatically.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

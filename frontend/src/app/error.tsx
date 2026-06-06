"use client";

// React Error Boundary for runtime crashes inside the root layout.
// Catches errors thrown during render of any `app/**/page.tsx` (and
// nested layouts below the root). Errors in the root `app/layout.tsx`
// itself escape this boundary and are caught by `app/global-error.tsx`.
//
// Why we have this: the Next.js default error page reads
// "Application error: a server-side exception has occurred (see the
// server logs for more information). Digest: <hash>" — the same
// generic message renders for server-side AND client-side crashes,
// and it doesn't surface the digest at all in a copy-pasteable
// form. That cost us ~2 hours during the v0.0.6 icon-route
// bundling regression. This page brings the digest forward so the
// first thing pasted to chat / Sentry is the breadcrumb that lets
// us cross-reference the Vercel runtime log directly.

import { useEffect } from "react";

import * as Sentry from "@sentry/nextjs";

import { PRIMARY_BUTTON } from "@/components/ui/styles";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // React error boundaries are NOT reported to Sentry automatically — the
    // SDK only auto-captures unhandled rejections + window.onerror, not
    // exceptions caught and rendered by `error.tsx`. So we explicitly forward
    // them. `Sentry.captureException` is a no-op when no DSN is configured,
    // so this stays safe in local dev and the bootstrap phase.
    Sentry.captureException(error);
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <main className="min-h-screen pl-14 flex items-center justify-center bg-[#0a0a0a] text-neutral-100">
      <div className="max-w-md mx-auto px-6 text-center space-y-4">
        <h1 className="text-2xl font-semibold text-orange-400">
          Something went wrong
        </h1>
        <p className="text-sm text-neutral-300">
          An unexpected error broke this page. The platform is still in closed
          beta — please mention this to the team along with the digest below.
        </p>
        {error.digest && (
          <div className="mt-2">
            <p className="text-[11px] uppercase tracking-wider text-neutral-500">
              Error digest
            </p>
            <code
              role="status"
              aria-live="polite"
              className="block mt-1 px-3 py-2 rounded-md bg-neutral-900 border border-neutral-700 text-xs font-mono text-neutral-300 select-all break-all"
            >
              {error.digest}
            </code>
          </div>
        )}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className={`inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
          >
            Try again
          </button>
          <a
            href="/map"
            className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 text-sm hover:bg-neutral-800 transition-colors"
          >
            Back to map
          </a>
        </div>
      </div>
    </main>
  );
}

"use client";

// Error boundary for crashes in any `app/**/page.tsx` and nested layouts
// below the root. Errors in the root `app/layout.tsx` itself escape here
// and are caught by `app/global-error.tsx`.
//
// The Next.js default error page renders a generic message for both
// server- and client-side crashes and never surfaces the digest in a
// copy-pasteable form. This page brings the digest forward so it can be
// cross-referenced against the Vercel runtime log.

import { useEffect } from "react";

import * as Sentry from "@sentry/nextjs";

import { Button, buttonClasses } from "@/components/ui/Button";
import { LABEL_TEXT } from "@/components/ui/form-styles";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // The SDK only auto-captures unhandled rejections + window.onerror,
    // not exceptions caught by an error boundary, so forward explicitly.
    // No-op when no DSN is configured (safe in local dev / bootstrap).
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
            <p className={LABEL_TEXT}>
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
          <Button
            type="button"
            onClick={reset}
          >
            Try again
          </Button>
          <a href="/map" className={buttonClasses("secondary")}>
            Back to map
          </a>
        </div>
      </div>
    </main>
  );
}

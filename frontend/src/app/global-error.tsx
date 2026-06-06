"use client";

// Last-resort error boundary for crashes that escape `app/error.tsx`.
// Specifically: errors thrown by the **root layout itself**
// (`app/layout.tsx`) or by Next.js's metadata pipeline (which runs
// above the page tree and can fail before `error.tsx` has a chance
// to mount — that's exactly the failure mode that triggered the
// v0.0.6 icon-route regression).
//
// Because the root layout is gone by the time this renders, this
// component is required to emit its own `<html>` / `<body>`. Keep
// the markup self-contained — no Tailwind class plumbing from the
// shared layout, no Providers context.

import { useEffect } from "react";

import * as Sentry from "@sentry/nextjs";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Mirror `app/error.tsx`: forward to Sentry explicitly because the SDK
    // doesn't auto-capture errors caught by a React error boundary. No-op
    // until `NEXT_PUBLIC_SENTRY_DSN` is set on Vercel.
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#f5f5f5",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: "32rem", padding: "1.5rem", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              color: "#fb923c",
              margin: 0,
            }}
          >
            Something went very wrong
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#d4d4d4",
              marginTop: "0.75rem",
              lineHeight: 1.5,
            }}
          >
            A critical error broke the page shell. Please mention this to the
            team along with the digest below.
          </p>
          {error.digest && (
            <div style={{ marginTop: "1rem" }}>
              <p
                style={{
                  fontSize: "0.6875rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#737373",
                  margin: 0,
                }}
              >
                Error digest
              </p>
              <code
                style={{
                  display: "block",
                  marginTop: "0.25rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.375rem",
                  background: "#171717",
                  border: "1px solid #404040",
                  fontSize: "0.75rem",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  color: "#d4d4d4",
                  wordBreak: "break-all",
                }}
              >
                {error.digest}
              </code>
            </div>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.375rem 0.75rem",
              borderRadius: "0.375rem",
              border: "1px solid rgba(249, 115, 22, 0.4)",
              background: "rgba(249, 115, 22, 0.1)",
              color: "#fb923c",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

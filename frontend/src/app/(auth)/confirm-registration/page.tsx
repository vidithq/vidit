"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

type State = "confirming" | "success" | "failed";

/**
 * Landing page for the link in the registration confirmation email.
 *
 * Auto-consumes the token on mount. The user already clicked the link;
 * making them push a second button just guarantees a chunk of them
 * abandon the flow. The hook runs exactly once even under React 18
 * Strict Mode by gating on a ref, so we don't double-consume the
 * (single-use!) token.
 *
 * On success the backend sets the session + CSRF cookies in the same
 * response, so we refresh /me and route to the map already signed in.
 */
function ConfirmInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>("confirming");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ranRef = useRef(false);
  const { refresh } = useAuth();

  // Refs survive Strict Mode's mount→cleanup→remount. We use a ref
  // (rather than a captured closure var) so the cleanup function
  // doesn't accidentally cancel a state update from a still-relevant
  // fetch that was issued by the previous mount.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (token.length < 10) {
      setState("failed");
      setErrorMsg("This confirmation link is missing a token.");
      return;
    }

    apiFetch("/auth/confirm-registration", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(async () => {
        try {
          await refresh();
        } catch {
          /* non-fatal — the next page load will catch up */
        }
        setState("success");
        // Short delay so the user reads the success message before
        // the hard navigate. Tracked on a ref so unmount can cancel a
        // stale push without blocking the success state in Strict-
        // Mode's mount→cleanup→remount cycle.
        redirectTimerRef.current = setTimeout(() => router.push("/map"), 800);
      })
      .catch((err) => {
        setState("failed");
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "This confirmation link is invalid or expired."
        );
      });

    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, [token, refresh, router]);

  return (
    <div className="w-full max-w-sm space-y-5 bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-2xl">
      {state === "confirming" && (
        <>
          <h1 className="text-lg font-medium text-neutral-100">
            Confirming your account…
          </h1>
          <p className="text-xs text-neutral-400">One moment.</p>
        </>
      )}

      {state === "success" && (
        <>
          <h1 className="text-lg font-medium text-neutral-100">
            Account confirmed
          </h1>
          <p className="text-xs text-neutral-400">
            Welcome to Vidit. Taking you to the map…
          </p>
        </>
      )}

      {state === "failed" && (
        <>
          <h1 className="text-lg font-medium text-neutral-100">
            Link no longer valid
          </h1>
          <p className="text-xs text-neutral-400">
            {errorMsg ??
              "This confirmation link is invalid or expired. Start the registration over to get a fresh one."}
          </p>
          <p className="text-xs">
            <Link href="/register" className="text-orange-400 hover:underline">
              Start over →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

export default function ConfirmRegistrationPage() {
  return (
    <Suspense
      fallback={<span className="text-neutral-500 text-sm">Loading…</span>}
    >
      <ConfirmInner />
    </Suspense>
  );
}

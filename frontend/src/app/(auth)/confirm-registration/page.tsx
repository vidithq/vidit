"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { AuthCard } from "@/components/auth/AuthCard";

type State = "confirming" | "success" | "failed";

/**
 * Landing page for the registration confirmation email link.
 *
 * Auto-consumes the token on mount (a second button drops users from the
 * flow). Gated on a ref so it runs once under Strict Mode and doesn't
 * double-consume the single-use token.
 *
 * On success the backend sets session + CSRF cookies in the same response,
 * so we refresh /me and route to the map already signed in.
 */
function ConfirmInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>("confirming");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ranRef = useRef(false);
  const { refresh } = useAuth();

  // Ref (not a closure var) so it survives Strict Mode's
  // mount→cleanup→remount and cleanup can't cancel a still-relevant
  // fetch's state update from the previous mount.
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
        // Delay so the user reads the success message before the hard
        // navigate; on a ref so unmount can cancel a stale push. A brand-new
        // account lands on the import on-ramp (backfill your X work) rather than
        // an empty map, the first step of the curated onboarding.
        redirectTimerRef.current = setTimeout(() => router.push("/import"), 800);
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

  const title = {
    confirming: "Confirming your account…",
    success: "Account confirmed",
    failed: "Link no longer valid",
  }[state];

  return (
    <AuthCard title={title}>
      {state === "confirming" && (
        <p className="text-xs text-neutral-400">One moment.</p>
      )}

      {state === "success" && (
        <p className="text-xs text-neutral-400">
          {"Welcome to Vidit. Let's bring your work onto the map, taking you to import your X archive…"}
        </p>
      )}

      {state === "failed" && (
        <>
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
    </AuthCard>
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

"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { useRedirectIfAuthenticated } from "@/hooks/useRedirectIfAuthenticated";
import { safeNext } from "@/lib/navigation";

function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  // Already signed in? Bounce to the app. Render nothing while
  // AuthContext resolves /auth/me, else a signed-in visitor sees a form
  // flash that reads as "session expired" and prompts a re-login.
  const { user, loading } = useRedirectIfAuthenticated(next);
  if (loading || user) return null;
  return <LoginForm onSuccess={() => router.push(next)} />;
}

export default function LoginPage() {
  // LoginForm's useSearchParams() (for the post-reset toast) forces a
  // Suspense boundary in Next 14+.
  return (
    <Suspense
      fallback={<span className="text-neutral-500 text-sm">Loading…</span>}
    >
      <LoginPageInner />
    </Suspense>
  );
}

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
  // Already signed in (e.g. landed here by typing the URL or an old
  // bookmark)? Bounce to the app instead of showing a login form.
  // Render nothing while AuthContext is still resolving /auth/me —
  // otherwise a signed-in visitor sees an empty form flash for
  // 50–200ms before the redirect fires, which reads as "session
  // expired" and can prompt them to retype credentials.
  const { user, loading } = useRedirectIfAuthenticated(next);
  if (loading || user) return null;
  return <LoginForm onSuccess={() => router.push(next)} />;
}

export default function LoginPage() {
  // LoginForm calls useSearchParams() to surface the post-reset toast,
  // which forces a Suspense boundary in Next 14+. Tiny wrapper.
  return (
    <Suspense
      fallback={<span className="text-neutral-500 text-sm">Loading…</span>}
    >
      <LoginPageInner />
    </Suspense>
  );
}

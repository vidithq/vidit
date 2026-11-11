"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { useRedirectIfAuthenticated } from "@/hooks/useRedirectIfAuthenticated";
import { safeNext } from "@/lib/navigation";
import { PageLoading } from "@/components/ui/PageShell";

function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  // Already signed in: bounce to the app. Render nothing while /auth/me resolves, else a signed-in visitor sees a form flash.
  const { user, loading } = useRedirectIfAuthenticated(next);
  if (loading || user) return null;
  return <LoginForm onSuccess={() => router.push(next)} />;
}

export default function LoginPage() {
  // useSearchParams() forces a Suspense boundary.
  return (
    <Suspense
      fallback={<PageLoading variant="line" />}
    >
      <LoginPageInner />
    </Suspense>
  );
}

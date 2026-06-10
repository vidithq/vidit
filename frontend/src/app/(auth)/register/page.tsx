"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RegisterForm from "@/components/auth/RegisterForm";
import { useRedirectIfAuthenticated } from "@/hooks/useRedirectIfAuthenticated";

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "";
  // Already signed in? Send them to the app. Block render while
  // AuthContext resolves /auth/me so a signed-in visitor never sees a
  // form flash before the redirect.
  const { user, loading } = useRedirectIfAuthenticated();
  if (loading || user) return null;
  return (
    <RegisterForm
      onSuccess={(email) =>
        router.push(`/registration-pending?email=${encodeURIComponent(email)}`)
      }
      initialInviteCode={code}
    />
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}

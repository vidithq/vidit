"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RegisterForm from "@/components/auth/RegisterForm";
import RegisterWithXForm from "@/components/auth/RegisterWithXForm";
import { useRedirectIfAuthenticated } from "@/hooks/useRedirectIfAuthenticated";

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "";
  // `?x=1` lands here from a successful /auth/x/callback that proved a handle
  // with no profile yet — finish the X-only account instead of the invite form.
  const xMode = searchParams.get("x") === "1";
  // Already signed in? Send them to the app. Block render while
  // AuthContext resolves /auth/me so a signed-in visitor never sees a
  // form flash before the redirect.
  const { user, loading } = useRedirectIfAuthenticated();
  if (loading || user) return null;
  if (xMode) return <RegisterWithXForm />;
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

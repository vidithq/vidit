"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { PageLoading } from "@/components/ui/PageShell";

/**
 * The bulk import now lives in the Submit hub as the Geolocation archive
 * sub-mode (one home for "add your work"). This route is kept as a redirect so
 * existing links (and the onboarding redirect target) still resolve.
 */
export default function ImportRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/submit?import=1");
  }, [router]);
  return <PageLoading />;
}

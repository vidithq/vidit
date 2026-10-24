"use client";

import { notFound, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/AdminContext";
import { DetectionStatsPanel } from "@/components/admin/DetectionStatsPanel";
import { ReportsPanel } from "@/components/admin/ReportsPanel";
import { EventActionsPanel } from "@/components/admin/EventActionsPanel";
import { OnboardingPanel } from "@/components/admin/OnboardingPanel";
import { ManageAnalystsPanel } from "@/components/admin/ManageAnalystsPanel";
import { OrganizationsPanel } from "@/components/admin/OrganizationsPanel";
import { PageLoading, PageShell } from "@/components/ui/PageShell";

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdmin();
  const router = useRouter();

  // Decide nothing until both probes resolve, else the first paint flashes "Loading… → 404".
  const probing = authLoading || adminLoading;

  useEffect(() => {
    if (!probing && !user) {
      router.push("/login?next=/admin");
    }
  }, [probing, user, router]);

  if (probing || !user) {
    return <PageLoading />;
  }

  if (!isAdmin) {
    notFound();
  }

  return (
    <PageShell title="Admin">
      <OnboardingPanel />
      <DetectionStatsPanel />
      <ManageAnalystsPanel />
      <OrganizationsPanel />
      <ReportsPanel />
      <EventActionsPanel />
    </PageShell>
  );
}

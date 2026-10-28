"use client";

import { notFound } from "next/navigation";

import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAdmin } from "@/contexts/AdminContext";
import { DetectionStatsPanel } from "@/components/admin/DetectionStatsPanel";
import { ReportsPanel } from "@/components/admin/ReportsPanel";
import { EventActionsPanel } from "@/components/admin/EventActionsPanel";
import { OnboardingPanel } from "@/components/admin/OnboardingPanel";
import { ManageAnalystsPanel } from "@/components/admin/ManageAnalystsPanel";
import { OrganizationsPanel } from "@/components/admin/OrganizationsPanel";
import { PageLoading, PageShell } from "@/components/ui/PageShell";

export default function AdminPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const { isAdmin, loading: adminLoading } = useAdmin();

  // Decide nothing until both probes resolve, else the first paint flashes "Loading… → 404".
  if (authLoading || adminLoading || !user) {
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

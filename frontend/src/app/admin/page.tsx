"use client";

import { notFound, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/useAdmin";
import { DetectionStatsPanel } from "@/components/admin/DetectionStatsPanel";
import { EventDeletePanel } from "@/components/admin/EventDeletePanel";
import { EventModerationPanel } from "@/components/admin/EventModerationPanel";
import { RecentSubmissionsPanel } from "@/components/admin/RecentSubmissionsPanel";
import { ReportsPanel } from "@/components/admin/ReportsPanel";
import { OnboardingPanel } from "@/components/admin/OnboardingPanel";
import { MaintenancePanel } from "@/components/admin/MaintenancePanel";
import { ManageAnalystsPanel } from "@/components/admin/ManageAnalystsPanel";
import { PageLoading, PageShell } from "@/components/ui/PageShell";

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdmin();
  const router = useRouter();

  // Decide nothing until both probes resolve, else an admin sees
  // "Loading… → 404" on first paint as the probes race.
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
      <RecentSubmissionsPanel />
      <ManageAnalystsPanel />
      {/* Moderation reads top to bottom: the queue says what was reported,
          the panel under it is the same two axes moved by hand. */}
      <ReportsPanel />
      <EventModerationPanel />
      <EventDeletePanel />
      <MaintenancePanel />
    </PageShell>
  );
}

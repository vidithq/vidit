"use client";

import { notFound, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/useAdmin";
import { DemoRequestsPanel } from "@/components/admin/DemoRequestsPanel";
import { DemoDataPanel } from "@/components/admin/DemoDataPanel";
import { DetectionStatsPanel } from "@/components/admin/DetectionStatsPanel";
import { EventDeletePanel } from "@/components/admin/EventDeletePanel";
import { OnboardingPanel } from "@/components/admin/OnboardingPanel";
import { MaintenancePanel } from "@/components/admin/MaintenancePanel";
import { TrustPanel } from "@/components/admin/TrustPanel";
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
      <TrustPanel />
      <EventDeletePanel />
      <DemoDataPanel />
      <DemoRequestsPanel />
      <MaintenancePanel />
    </PageShell>
  );
}

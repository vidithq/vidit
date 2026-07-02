"use client";

import { notFound, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/useAdmin";
import { DemoBountiesPanel } from "@/components/admin/DemoBountiesPanel";
import { DemoDataPanel } from "@/components/admin/DemoDataPanel";
import { GeolocationDeletePanel } from "@/components/admin/GeolocationDeletePanel";
import { InviteCodesPanel } from "@/components/admin/InviteCodesPanel";
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
      <InviteCodesPanel />
      <TrustPanel />
      <GeolocationDeletePanel />
      <DemoDataPanel />
      <DemoBountiesPanel />
      <MaintenancePanel />
    </PageShell>
  );
}

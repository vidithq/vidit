"use client";

import { useState } from "react";

import {
  reapAuthTokens,
  reapPendingRegistrations,
  type MaintenanceResponse,
} from "@/lib/admin";
import { useMutation } from "@/hooks/useMutation";
import { DevToolPanel } from "@/components/admin/DevToolPanel";
import { Button } from "@/components/ui/Button";

export function MaintenancePanel() {
  const [authResult, setAuthResult] = useState<MaintenanceResponse | null>(
    null
  );
  const [pendingResult, setPendingResult] = useState<MaintenanceResponse | null>(
    null
  );

  const reapAuth = useMutation(reapAuthTokens, {
    fallback: "Failed",
    onSuccess: setAuthResult,
  });
  const reapPending = useMutation(reapPendingRegistrations, {
    fallback: "Failed",
    onSuccess: setPendingResult,
  });

  // Both actions share one error slot, cleared when either fires (the other's
  // `reset()` mirrors the old single `setError(null)` at the top of each).
  const error = reapAuth.error ?? reapPending.error;
  const running = reapAuth.loading || reapPending.loading;

  const onReapAuth = () => {
    reapPending.reset();
    void reapAuth.run();
  };

  const onReapPending = () => {
    reapAuth.reset();
    void reapPending.run();
  };

  return (
    <DevToolPanel
      title="Maintenance"
      description={
        <>On-demand reapers. Click when you remember; there&apos;s no schedule.</>
      }
    >
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={onReapAuth} disabled={running}>
            {reapAuth.loading ? "Reaping…" : "Reap expired auth tokens"}
          </Button>
          {authResult && (
            <span className="text-xs text-neutral-400">
              Expired: {authResult.expired ?? 0} · Old consumed:{" "}
              {authResult.old_consumed ?? 0}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={onReapPending} disabled={running}>
            {reapPending.loading
              ? "Reaping…"
              : "Reap expired pending registrations"}
          </Button>
          {pendingResult && (
            <span className="text-xs text-neutral-400">
              Deleted: {pendingResult.pending_registrations_deleted ?? 0}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
    </DevToolPanel>
  );
}

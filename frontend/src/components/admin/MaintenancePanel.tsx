"use client";

import { useState } from "react";

import {
  reapAuthTokens,
  reapProofOrphans,
  type MaintenanceResponse,
} from "@/lib/admin";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Button } from "@/components/ui/Button";

export function MaintenancePanel() {
  const [authResult, setAuthResult] = useState<MaintenanceResponse | null>(
    null
  );
  const [orphanResult, setOrphanResult] = useState<MaintenanceResponse | null>(
    null
  );

  const reapAuth = useMutation(reapAuthTokens, {
    fallback: "Failed",
    onSuccess: setAuthResult,
  });
  const reapOrphans = useMutation(reapProofOrphans, {
    fallback: "Failed",
    onSuccess: setOrphanResult,
  });

  // Both actions share one error slot, cleared when either fires (the other's
  // `reset()` mirrors the old single `setError(null)` at the top of each).
  const error = reapAuth.error ?? reapOrphans.error;
  const running = reapAuth.loading || reapOrphans.loading;

  const onReapAuth = () => {
    reapOrphans.reset();
    void reapAuth.run();
  };

  const onReapOrphans = () => {
    reapAuth.reset();
    void reapOrphans.run();
  };

  return (
    <section className="border border-neutral-800 rounded-lg bg-neutral-900/50">
      <header className="px-4 py-3 border-b border-neutral-800">
        <SectionEyebrow title="Maintenance" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          On-demand reapers. Click when you remember — there&apos;s no schedule.
        </p>
      </header>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-3">
          <Button variant="neutral" onClick={onReapAuth} disabled={running}>
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
          <Button variant="neutral" onClick={onReapOrphans} disabled={running}>
            {reapOrphans.loading
              ? "Reaping…"
              : "Reap orphan proof images"}
          </Button>
          {orphanResult && (
            <span className="text-xs text-neutral-400">
              Rows: {orphanResult.rows_deleted ?? 0} · S3:{" "}
              {orphanResult.s3_deleted ?? 0}
              {orphanResult.s3_failed
                ? ` · failed: ${orphanResult.s3_failed}`
                : ""}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </section>
  );
}

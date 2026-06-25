"use client";

import { useState } from "react";

import {
  reapAuthTokens,
  reapProofOrphans,
  type MaintenanceResponse,
} from "@/lib/admin";
import { useMutation } from "@/hooks/useMutation";

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
        <h2 className="text-sm font-medium text-neutral-200">Maintenance</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          On-demand reapers. Click when you remember — there&apos;s no schedule.
        </p>
      </header>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onReapAuth}
            disabled={running}
            className="px-3 py-1.5 rounded-md text-sm border border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 transition-colors"
          >
            {reapAuth.loading ? "Reaping…" : "Reap expired auth tokens"}
          </button>
          {authResult && (
            <span className="text-xs text-neutral-400">
              Expired: {authResult.expired ?? 0} · Old consumed:{" "}
              {authResult.old_consumed ?? 0}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onReapOrphans}
            disabled={running}
            className="px-3 py-1.5 rounded-md text-sm border border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 transition-colors"
          >
            {reapOrphans.loading
              ? "Reaping…"
              : "Reap orphan proof images"}
          </button>
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

"use client";

import { useEffect, useState } from "react";

import { getDetectionStats, type DetectionStats } from "@/lib/admin";
import { errorMessage } from "@/lib/api";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { Card } from "@/components/ui/Card";

// Local to this panel: admin surfaces inline their markup rather than minting a
// shared primitive (see docs/design.md, the admin-dialect section, where admin
// internals don't earn palette entries). A quiet bordered stat cell, not a
// reusable card.
function Stat({
  value,
  label,
  hint,
}: {
  value: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="border border-neutral-800 rounded-md p-3">
      <div className="text-lg font-semibold text-neutral-100 tabular-nums">
        {value}
      </div>
      <div className="text-xs text-neutral-400 mt-0.5">{label}</div>
      {hint && <div className="text-[11px] text-neutral-600 mt-1">{hint}</div>}
    </div>
  );
}

export function DetectionStatsPanel() {
  const [stats, setStats] = useState<DetectionStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDetectionStats()
      .then((s) => {
        if (cancelled) return;
        setStats(s);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, "Failed to load detection stats"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rejectRate =
    stats && stats.machine_total > 0
      ? `${(stats.reject_rate * 100).toFixed(1)}%`
      : "—";

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Detection quality" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Quality signal on the machine-extraction pipeline. A{" "}
          <span className="text-neutral-300">machine detection</span> is a row
          imported from X (the archive backfill or the bot;{" "}
          <code className="text-neutral-400">detected_from_url</code> set). The{" "}
          <span className="text-neutral-300">reject-rate</span> is the share of
          machine detections dismissed while still a draft, whichever door they
          left through: an owner closed straight out of{" "}
          <code className="text-neutral-400">detected</code>, or an admin
          soft-deleted while still{" "}
          <code className="text-neutral-400">detected</code>. A detection
          vouched into{" "}
          <code className="text-neutral-400">geolocated</code>, or still
          awaiting review, is not a reject. The pending counts profile the live
          review queue (machine drafts, demo rows excluded) for drafts missing a
          piece the geolocate floor will demand.
        </p>
      </header>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

      {stats === null && !error && (
        <div className="text-xs text-neutral-500 py-2">Loading…</div>
      )}

      {stats !== null && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat
              value={rejectRate}
              label="Reject-rate"
              hint={
                stats.machine_total > 0
                  ? `${stats.machine_rejected} of ${stats.machine_total} machine detections`
                  : "No machine detections yet"
              }
            />
            <Stat value={String(stats.machine_total)} label="Machine detections" />
            <Stat
              value={String(stats.machine_rejected)}
              label="Rejected (closed from detected)"
            />
          </div>

          <div>
            <p className="text-xs text-neutral-500 mb-2">
              Pending machine detections (
              <span className="text-neutral-300">{stats.pending}</span> live{" "}
              <code className="text-neutral-400">detected</code> rows) missing a
              required piece:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat
                value={String(stats.pending_missing_source_media)}
                label="No source media"
              />
              <Stat
                value={String(stats.pending_missing_proof_image)}
                label="No proof image"
              />
              <Stat
                value={String(stats.pending_missing_source_url)}
                label="No source URL"
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

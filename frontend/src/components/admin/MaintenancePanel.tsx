"use client";

import { useState } from "react";

import { runMaintenance, type AdminMaintenanceResult, type MaintenanceJob } from "@/lib/admin";
import { useMutation } from "@/hooks/useMutation";
import { ActionReceipt } from "@/components/admin/ActionReceipt";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

/** One button per `POST /admin/maintenance/{job}`. A reaper drops expired rows at once; the digest
 *  emails analysts, so it confirms. */
const JOBS: { job: MaintenanceJob; label: string; confirm: boolean }[] = [
  { job: "reap-password-reset-tokens", label: "Reap reset tokens", confirm: false },
  { job: "reap-pending-registrations", label: "Reap pending registrations", confirm: false },
  { job: "send-completion-digests", label: "Send completion digests", confirm: true },
];

/** The receipt's line for each count a job returns, in the order a job fills them. */
const COUNT_LABELS: Record<keyof AdminMaintenanceResult, string> = {
  expired: "Expired reset tokens dropped",
  old_consumed: "Old used reset tokens dropped",
  pending_registrations_deleted: "Expired pending registrations dropped",
  analysts_notified: "Analysts emailed",
  detections_pending: "Detections the emails covered",
  digest_send_failures: "Failed sends",
};

/**
 * The maintenance jobs, run on demand: each one is audited under its own action and answers with
 * its counts, which the receipt lists. Run the digest again to reach the analysts past its
 * per-run cap.
 */
export function MaintenancePanel() {
  const [receipt, setReceipt] = useState<{ label: string; data: AdminMaintenanceResult } | null>(
    null,
  );
  const run = useMutation((job: (typeof JOBS)[number]) => runMaintenance(job.job), {
    fallback: "Maintenance job failed",
    onSuccess: (data, job) => setReceipt({ label: job.label, data }),
  });

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Maintenance" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Drop expired password reset tokens and pending registrations, or email each analyst
          holding unpublished detections their count, 200 analysts per run.
        </p>
      </header>

      {run.error && <ErrorNotice error={run.error} />}

      <div className="flex flex-wrap gap-2">
        {JOBS.map((job) =>
          job.confirm ? (
            <ConfirmButton
              key={job.job}
              action="send"
              label={job.label}
              disabled={run.loading}
              onConfirm={() => run.run(job)}
            />
          ) : (
            <Button
              key={job.job}
              action="remove"
              variant="secondary"
              disabled={run.loading}
              onClick={() => void run.run(job)}
            >
              {job.label}
            </Button>
          ),
        )}
      </div>

      {receipt && (
        <ActionReceipt action="Done" header={<span className="font-medium">{receipt.label}</span>}>
          {(Object.keys(COUNT_LABELS) as (keyof AdminMaintenanceResult)[])
            .filter((key) => receipt.data[key] != null)
            .map((key) => (
              <div key={key} className="text-neutral-500">
                {COUNT_LABELS[key]}: {receipt.data[key]}
              </div>
            ))}
        </ActionReceipt>
      )}
    </Card>
  );
}

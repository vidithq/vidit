"use client";

import { useState, type ReactNode } from "react";

import {
  reapAuthTokens,
  reapPendingRegistrations,
  sendCompletionDigests,
  type MaintenanceResponse,
} from "@/lib/admin";
import { useMutation } from "@/hooks/useMutation";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Button } from "@/components/ui/Button";

/**
 * One Maintenance row: the button plus the counts its last run returned.
 * Every action renders through this, so a third one costs a list entry rather
 * than another copy of the button + result markup.
 */
function MaintenanceRow({
  label,
  busyLabel,
  loading,
  disabled,
  onClick,
  summary,
}: {
  label: string;
  busyLabel: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  summary: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" onClick={onClick} disabled={disabled}>
        {loading ? busyLabel : label}
      </Button>
      {summary && <span className="text-xs text-neutral-400">{summary}</span>}
    </div>
  );
}

export function MaintenancePanel() {
  const [authResult, setAuthResult] = useState<MaintenanceResponse | null>(null);
  const [pendingResult, setPendingResult] = useState<MaintenanceResponse | null>(
    null
  );
  const [digestResult, setDigestResult] = useState<MaintenanceResponse | null>(
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
  const sendDigests = useMutation(sendCompletionDigests, {
    fallback: "Failed",
    onSuccess: setDigestResult,
  });

  // The actions share one error slot, cleared when any of them fires (each
  // run resets the others).
  const mutations = [reapAuth, reapPending, sendDigests];
  const error = reapAuth.error ?? reapPending.error ?? sendDigests.error;
  const running = mutations.some((m) => m.loading);

  const start = (target: (typeof mutations)[number]) => () => {
    mutations.filter((m) => m !== target).forEach((m) => m.reset());
    void target.run();
  };

  return (
    // Deliberately lighter than the `<Card as="section">` the real admin
    // actions use (translucent background, bordered header), so dev tooling
    // reads as a separate register on the admin page.
    <section className="border border-neutral-800 rounded-lg bg-neutral-900/50">
      <header className="px-4 py-3 border-b border-neutral-800">
        <SectionEyebrow title="Maintenance" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          On-demand sweeps. Click when you remember; there&apos;s no schedule.
        </p>
      </header>
      <div className="px-4 py-3 space-y-3">
        <MaintenanceRow
          label="Reap expired auth tokens"
          busyLabel="Reaping…"
          loading={reapAuth.loading}
          disabled={running}
          onClick={start(reapAuth)}
          summary={
            authResult && (
              <>
                Expired: {authResult.expired ?? 0} · Old consumed:{" "}
                {authResult.old_consumed ?? 0}
              </>
            )
          }
        />
        <MaintenanceRow
          label="Reap expired pending registrations"
          busyLabel="Reaping…"
          loading={reapPending.loading}
          disabled={running}
          onClick={start(reapPending)}
          summary={
            pendingResult && (
              <>Deleted: {pendingResult.pending_registrations_deleted ?? 0}</>
            )
          }
        />
        <MaintenanceRow
          label="Email the drafts-awaiting-completion digest"
          busyLabel="Sending…"
          loading={sendDigests.loading}
          disabled={running}
          onClick={start(sendDigests)}
          summary={
            digestResult && (
              <>
                Analysts emailed: {digestResult.analysts_notified ?? 0} · Drafts:{" "}
                {digestResult.drafts_pending ?? 0} · Failed sends:{" "}
                {digestResult.digest_send_failures ?? 0}
              </>
            )
          }
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </section>
  );
}

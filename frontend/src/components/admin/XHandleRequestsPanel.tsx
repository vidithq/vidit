"use client";

import { useState } from "react";

import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { formatInstant } from "@/lib/format";
import {
  X_HANDLE_REASON_MAX_LEN,
  X_HANDLE_REQUESTS_PATH,
  approveXHandleRequest,
  declineXHandleRequest,
  type AdminXHandleRequest,
} from "@/lib/xHandle";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";

function RequestRow({
  request,
  onDecided,
}: {
  request: AdminXHandleRequest;
  onDecided: () => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const approve = useMutation(() => approveXHandleRequest(request.id), {
    fallback: "Approve failed",
    onSuccess: onDecided,
  });
  const decline = useMutation(() => declineXHandleRequest(request.id, reason.trim()), {
    fallback: "Decline failed",
    onSuccess: onDecided,
  });
  const busy = approve.loading || decline.loading;
  const error = approve.error ?? decline.error;
  const { user } = request;

  return (
    <li className="border border-neutral-800 rounded-md p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-sm text-neutral-100">{user.username}</span>
        {user.email && <span className="text-neutral-500 wrap-anywhere">{user.email}</span>}
        <span className="text-neutral-500">{formatInstant(request.created_at)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
        <Pill>{user.x_handle ? `X: @${user.x_handle}` : "No X handle"}</Pill>
        <span aria-hidden>→</span>
        <Pill tone="accent">X: @{request.x_handle}</Pill>
      </div>
      {request.reason && (
        <p className="text-xs text-neutral-400 whitespace-pre-wrap wrap-anywhere">
          {request.reason}
        </p>
      )}

      {error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {error}
        </div>
      )}

      {declining ? (
        <div className="space-y-2">
          <label className={FORM_LABEL} htmlFor={`x-handle-decline-${request.id}`}>
            Reason (the analyst reads it in Settings)
          </label>
          <Textarea
            variant="compact"
            id={`x-handle-decline-${request.id}`}
            rows={2}
            maxLength={X_HANDLE_REASON_MAX_LEN}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={busy || !reason.trim()}
              onClick={() => void decline.run()}
            >
              {decline.loading ? "Declining…" : "Decline"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDeclining(false);
                decline.reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void approve.run()}>
            {approve.loading ? "Approving…" : "Approve"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              approve.reset();
              setDeclining(true);
            }}
          >
            Decline
          </Button>
        </div>
      )}
    </li>
  );
}

/** Pending X handle change requests, oldest first. Approving links the handle through the
 *  same write path as the analyst card's link action, so a handle another account holds is
 *  refused there too. */
export function XHandleRequestsPanel() {
  const { data, error, loading, refetch } =
    useApiResource<AdminXHandleRequest[]>(X_HANDLE_REQUESTS_PATH);
  const requests = data ?? [];

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="X handle requests" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Analysts ask here for a new X handle on their account. Check that the analyst
          controls the handle before you approve. Either decision notifies the analyst.
        </p>
      </header>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {loading && !error && <div className="text-xs text-neutral-500 py-2">Loading…</div>}
      {!loading && !error && requests.length === 0 && (
        <p className="text-xs text-neutral-500 py-2">No pending requests.</p>
      )}

      {requests.length > 0 && (
        <ul className="space-y-2">
          {requests.map((request) => (
            <RequestRow key={request.id} request={request} onDecided={refetch} />
          ))}
        </ul>
      )}
    </Card>
  );
}

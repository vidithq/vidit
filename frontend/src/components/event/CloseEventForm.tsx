"use client";

import { useState } from "react";

import { closeEvent } from "@/lib/events";
import { useMutation } from "@/hooks/useMutation";
import type { EventDetail, EventStatus } from "@/types";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { FORM_LABEL, FORM_ERROR_BANNER } from "@/components/ui/form-styles";

interface CloseEventFormProps {
  eventId: string;
  /** The row's current status, so the copy names the action: a `requested` row
   *  is withdrawn, a `detected` row is rejected. */
  status: EventStatus;
  /** Called with the closed event on success (the parent refetches / routes). */
  onClosed: (closed: EventDetail) => void;
  /** Dismiss without closing (returns to the trigger). */
  onCancel: () => void;
  /** Disable the controls while a sibling action is mid-flight. */
  disabled?: boolean;
}

/**
 * Inline "close this event" panel: a required free-text reason plus a confirm /
 * cancel pair, composed from the shared primitives (`Textarea`, `Button`, the
 * `FORM_*` constants). One verb closes both dismissal shapes — a withdrawn
 * request and a rejected detection — so the copy keys off `status`. The reason
 * stays publicly visible on the closed row (transparency), which is why the
 * backend requires it; this enforces the same non-empty rule client-side.
 */
export function CloseEventForm({
  eventId,
  status,
  onClosed,
  onCancel,
  disabled = false,
}: CloseEventFormProps) {
  const [reason, setReason] = useState("");
  const [emptyReason, setEmptyReason] = useState(false);
  const isRequest = status === "requested";
  const noun = isRequest ? "request" : "detection";
  const verb = isRequest ? "Withdraw" : "Reject";

  const closeMutation = useMutation(() => closeEvent(eventId, reason.trim()), {
    fallback: "Close failed",
    onSuccess: (closed) => onClosed(closed),
  });

  const submit = () => {
    closeMutation.reset();
    if (!reason.trim()) {
      setEmptyReason(true);
      return;
    }
    void closeMutation.run();
  };

  const busy = closeMutation.loading || disabled;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="close_reason" className={FORM_LABEL}>
          {verb} reason
        </label>
        <Textarea
          id="close_reason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (emptyReason) setEmptyReason(false);
          }}
          invalid={emptyReason}
          placeholder={
            isRequest
              ? "Why are you withdrawing this request? (stays visible on the closed row)"
              : "Why isn't this a valid detection? (stays visible on the closed row)"
          }
        />
        <p className="text-xs text-neutral-500">
          The reason stays publicly visible next to the closed badge.
        </p>
      </div>

      {emptyReason && (
        <div className={FORM_ERROR_BANNER} role="alert">
          A reason is required to close this {noun}.
        </div>
      )}
      {closeMutation.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {closeMutation.error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="danger" onClick={submit} disabled={busy}>
          {closeMutation.loading ? "Closing…" : `${verb} this ${noun}`}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

import { CLOSE_REASON_MAX_LEN, closeEvent } from "@/lib/events";
import { useMutation } from "@/hooks/useMutation";
import type { EventDetail, EventStatus } from "@/types";
import { FIELD_HELP, type Concept } from "@/lib/fieldHelp";
import { CharCounter } from "@/components/ui/CharCounter";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Textarea } from "@/components/ui/Input";
import { FORM_LABEL, FORM_ERROR_BANNER } from "@/components/ui/form-styles";

/**
 * What each row is called, for the one verb that closes all of them. The verb is always *Close*:
 * one write ends a request, a detection and a published geolocation, and per-shape verbs would
 * let the menu item and the confirm button drift. The noun names the row. A `closed`
 * row offers no close, so the generic noun covers it rather than a fourth entry.
 */
const CLOSE_NOUN: Partial<Record<EventStatus, string>> = {
  requested: "request",
  detected: "detection",
  geolocated: "geolocation",
};

/** What closing does, per row, as the dialog's opening sentence. */
const CLOSE_HELP: Partial<Record<EventStatus, Concept>> = {
  requested: "close_request",
  detected: "close_detection",
  geolocated: "close_geolocation",
};

/** What this row is called in the close copy (see `CLOSE_NOUN`). */
function closeNoun(status: EventStatus): string {
  return CLOSE_NOUN[status] ?? "event";
}

/** The row's own close label, as the menu item and the dialog's confirm button print it. */
export function closeActionLabel(status: EventStatus): string {
  return `Close this ${closeNoun(status)}`;
}

interface CloseEventDialogProps {
  eventId: string;
  /** The row's current status, which names the row in the copy. */
  status: EventStatus;
  /** Called with the closed event on success (the parent refetches / routes). */
  onClosed: (closed: EventDetail) => void;
  /** Dismiss without closing. */
  onCancel: () => void;
  /** Hold the confirm while a sibling action is mid-flight. */
  disabled?: boolean;
}

/**
 * The close of an owner's edit page, opened from its red close button: a `ConfirmDialog` that
 * says what closing does, then a required free-text reason, **Cancel** and **Close this …**.
 * `status` only picks the noun (`CLOSE_NOUN`). The reason stays publicly visible on the closed
 * row, so the backend requires it; this enforces the same non-empty rule client-side.
 */
export function CloseEventDialog({
  eventId,
  status,
  onClosed,
  onCancel,
  disabled = false,
}: CloseEventDialogProps) {
  const [reason, setReason] = useState("");
  const [emptyReason, setEmptyReason] = useState(false);
  const noun = closeNoun(status);
  const help = CLOSE_HELP[status];

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

  return (
    <ConfirmDialog
      title={closeActionLabel(status)}
      confirmLabel={closeActionLabel(status)}
      busyLabel="Closing…"
      busy={closeMutation.loading}
      confirmDisabled={disabled}
      error={closeMutation.error}
      onConfirm={submit}
      onCancel={onCancel}
    >
      {help && <p>{FIELD_HELP[help].text}</p>}
      <div className="space-y-1.5">
        <span className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1">
            <label htmlFor="close_reason" className={FORM_LABEL}>
              Close reason
            </label>
            <FieldHelp concept="close_reason" />
          </span>
          <CharCounter length={reason.length} max={CLOSE_REASON_MAX_LEN} />
        </span>
        <Textarea
          id="close_reason"
          rows={3}
          maxLength={CLOSE_REASON_MAX_LEN}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (emptyReason) setEmptyReason(false);
          }}
          invalid={emptyReason}
          placeholder={`Why are you closing this ${noun}? (stays visible on the closed row)`}
        />
      </div>
      {emptyReason && (
        <div className={FORM_ERROR_BANNER} role="alert">
          A reason is required to close this {noun}.
        </div>
      )}
    </ConfirmDialog>
  );
}

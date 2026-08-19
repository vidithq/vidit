"use client";

import { useState } from "react";

import { closeEvent } from "@/lib/events";
import { useMutation } from "@/hooks/useMutation";
import type { EventDetail, EventStatus } from "@/types";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { FORM_LABEL, FORM_ERROR_BANNER } from "@/components/ui/form-styles";

interface CloseCopy {
  verb: string;
  noun: string;
  prompt: string;
}

/**
 * How the one close verb reads in each state, in one place: the action row's
 * button, the panel's eyebrow and this form all name the same act, so a reader
 * is never offered "Close this request" on a published geolocation. The three
 * live shapes are the same write and differ only in what the author is saying:
 * an ask dropped, a machine reading judged wrong, a claim taken back. A
 * `closed` row is the state the verb produces and carries no live verb, so it
 * falls back to the plain word rather than borrowing another shape's.
 */
const CLOSE_COPY: Record<EventStatus, CloseCopy> = {
  requested: {
    verb: "Withdraw",
    noun: "request",
    prompt: "Why are you withdrawing this request?",
  },
  detected: {
    verb: "Reject",
    noun: "detection",
    prompt: "Why isn't this a valid detection?",
  },
  geolocated: {
    verb: "Retract",
    noun: "geolocation",
    prompt: "Why are you retracting this geolocation?",
  },
  closed: {
    verb: "Close",
    noun: "event",
    prompt: "Why are you closing this event?",
  },
};

/** The close vocabulary for one row's state (see `CLOSE_COPY`). */
export function closeCopy(status: EventStatus): CloseCopy {
  return CLOSE_COPY[status];
}

/** The row's own close label, as the action row and the panel eyebrow print it. */
export function closeActionLabel(status: EventStatus): string {
  const { verb, noun } = closeCopy(status);
  return `${verb} this ${noun}`;
}

interface CloseEventFormProps {
  eventId: string;
  /** The row's current status, so the copy names the action: a `requested` row
   *  is withdrawn, a `detected` row is rejected, a `geolocated` row retracted. */
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
 * `FORM_*` constants). One verb closes all three dismissal shapes, so the copy
 * keys off `status` through `CLOSE_COPY`. The reason stays publicly visible on
 * the closed row (transparency), which is why the backend requires it; this
 * enforces the same non-empty rule client-side.
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
  const { verb, noun, prompt } = closeCopy(status);

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
          placeholder={`${prompt} (stays visible on the closed row)`}
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
          {closeMutation.loading ? "Closing…" : closeActionLabel(status)}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

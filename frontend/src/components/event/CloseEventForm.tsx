"use client";

import { useState } from "react";

import { closeEvent } from "@/lib/events";
import { useMutation } from "@/hooks/useMutation";
import type { EventDetail, EventStatus } from "@/types";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { FORM_LABEL, FORM_ERROR_BANNER } from "@/components/ui/form-styles";

/**
 * What each row is called, for the one verb that closes all of them. The verb
 * is always *Close*: one write ends a request, a detection and a published
 * geolocation alike, and giving each shape its own verb asked a reader to learn
 * three words for one act and left the action row, the panel eyebrow and the
 * confirm button free to drift apart. The noun still names the row, so the
 * label says what is being closed.
 *
 * A `closed` row is the state the verb produces and offers no close, so it
 * never reaches this map; the generic noun covers it rather than a fourth
 * entry claiming a shape that has none.
 */
const CLOSE_NOUN: Partial<Record<EventStatus, string>> = {
  requested: "request",
  detected: "detection",
  geolocated: "geolocation",
};

/** What this row is called in the close copy (see `CLOSE_NOUN`). */
function closeNoun(status: EventStatus): string {
  return CLOSE_NOUN[status] ?? "event";
}

/** The row's own close label, as the action row, the panel eyebrow and this
 *  form's confirm button all print it. */
export function closeActionLabel(status: EventStatus): string {
  return `Close this ${closeNoun(status)}`;
}

interface CloseEventFormProps {
  eventId: string;
  /** The row's current status, which names the row in the copy: a request, a
   *  detection or a geolocation. The verb is *Close* in every case. */
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
 * `FORM_*` constants). One verb closes all three live shapes, and `status` only
 * picks the noun it is spelled with (`CLOSE_NOUN`). The reason stays publicly
 * visible on the closed row (transparency), which is why the backend requires
 * it; this enforces the same non-empty rule client-side.
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
  const noun = closeNoun(status);

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
          Close reason
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
          placeholder={`Why are you closing this ${noun}? (stays visible on the closed row)`}
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

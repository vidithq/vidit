"use client";

import { useState } from "react";

import { closeEvent } from "@/lib/events";
import { useMutation } from "@/hooks/useMutation";
import type { EventDetail, EventStatus } from "@/types";
import type { Concept } from "@/lib/fieldHelp";
import { Button } from "@/components/ui/Button";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { Textarea } from "@/components/ui/Input";
import { FORM_LABEL, FORM_ERROR_BANNER } from "@/components/ui/form-styles";

/**
 * What each row is called, for the one verb that closes all of them. The verb is always *Close*:
 * one write ends a request, a detection and a published geolocation, and per-shape verbs would
 * let the open button and the confirm button drift. The noun names the row. A `closed`
 * row offers no close, so the generic noun covers it rather than a fourth entry.
 */
const CLOSE_NOUN: Partial<Record<EventStatus, string>> = {
  requested: "request",
  detected: "detection",
  geolocated: "geolocation",
};

/** What closing does, per row, as the close button's help. */
const CLOSE_HELP: Partial<Record<EventStatus, Concept>> = {
  requested: "close_request",
  detected: "close_detection",
  geolocated: "close_geolocation",
};

/** What this row is called in the close copy (see `CLOSE_NOUN`). */
function closeNoun(status: EventStatus): string {
  return CLOSE_NOUN[status] ?? "event";
}

/** The row's own close label, as the open button and this form's confirm button print it. */
function closeActionLabel(status: EventStatus): string {
  return `Close this ${closeNoun(status)}`;
}

interface CloseEventFormProps {
  eventId: string;
  /** The row's current status, which names the row in the copy. */
  status: EventStatus;
  /** Called with the closed event on success (the parent refetches / routes). */
  onClosed: (closed: EventDetail) => void;
  /** Dismiss without closing (returns to the trigger). */
  onCancel: () => void;
  /** Disable the controls while a sibling action is mid-flight. */
  disabled?: boolean;
}

/**
 * Inline "close this event" panel: a required free-text reason plus confirm and cancel, composed
 * from shared primitives. `status` only picks the noun (`CLOSE_NOUN`). The reason stays publicly
 * visible on the closed row, so the backend requires it; this enforces the same non-empty rule
 * client-side.
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
        <span className="inline-flex items-center gap-1">
          <label htmlFor="close_reason" className={FORM_LABEL}>
            Close reason
          </label>
          <FieldHelp concept="close_reason" />
        </span>
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

/**
 * The close at the foot of an owner's edit page actions card, under the save: **Close this …**,
 * with what closing does in its help, which opens `CloseEventForm` in place.
 */
export function CloseSection({
  eventId,
  status,
  onClosed,
  disabled = false,
}: Omit<CloseEventFormProps, "onCancel">) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3 border-t border-neutral-800 pt-4">
      {open ? (
        <CloseEventForm
          eventId={eventId}
          status={status}
          onClosed={onClosed}
          onCancel={() => setOpen(false)}
          disabled={disabled}
        />
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <Button variant="danger" onClick={() => setOpen(true)} disabled={disabled}>
            {closeActionLabel(status)}
          </Button>
          {CLOSE_HELP[status] && <FieldHelp concept={CLOSE_HELP[status]} />}
        </span>
      )}
    </div>
  );
}

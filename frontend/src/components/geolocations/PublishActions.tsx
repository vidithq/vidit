"use client";

import { useState, type ReactNode } from "react";
import { MapPin, Megaphone } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { CountBadge } from "@/components/ui/CountBadge";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { PopoverPanel } from "@/components/ui/Popover";
import { ACCENT_SURFACE, ARMED_RING } from "@/components/ui/styles";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { cn } from "@/lib/cn";
import { missingSummary, type MissingField } from "@/lib/events";
import type { Concept } from "@/lib/fieldHelp";

/** What an armed button reads. One word no longer than a publish label, so arming never widens
 *  the line. */
const ARMED_LABEL = "Confirm";

/** The armed sentence of a geolocation publish, on the submit form and the edit form. */
export const PUBLISH_CONFIRM =
  "Click again to publish. The geolocation becomes public at version 1; later changes become versions.";

/** The armed sentence of a request publish. */
export const REQUEST_CONFIRM =
  "Click again to publish. The request becomes public, open for anyone to geolocate.";

/** A button's label while its write runs. */
export const PUBLISHING_LABEL = "Publishing…";
export const SAVING_LABEL = "Saving…";

/**
 * One write of an event form. `attempt` runs `check` and, when it passes, the write: at once;
 * with `confirm`, on the second click, since a publish makes the event public; with `ask`, once
 * the panel the first click opens confirms (`ask.confirm`), for a write that takes one more
 * input (a version's note).
 */
export function usePublishAction({
  check,
  write,
  confirm,
  ask = false,
}: {
  /** Flags what holds the write (missing fields, a running upload). True when it may go. */
  check: () => boolean;
  write: () => void;
  /** The armed button's sentence, for screen readers. Set, a first click arms. */
  confirm?: string;
  /** A first click opens the button's `ask` panel instead of writing. */
  ask?: boolean;
}) {
  const { armed, trigger, cancel, controlRef } = useConfirmAction(write, {
    timeoutMs: ARM_MS,
    dismissOnOutside: true,
  });
  const [asking, setAsking] = useState(false);
  const attempt = () => {
    if (!check()) {
      cancel();
      setAsking(false);
      return;
    }
    if (ask) setAsking(true);
    else if (confirm) trigger();
    else write();
  };
  return {
    attempt,
    armed: confirm !== undefined && armed,
    controlRef,
    confirm,
    asking,
    /** Closes the panel and writes. */
    confirmAsk: () => {
      setAsking(false);
      write();
    },
    /** Closes the panel, writing nothing; `restoreFocus` returns focus to the button. */
    cancelAsk: (restoreFocus: boolean) => {
      setAsking(false);
      if (restoreFocus) controlRef.current?.focus();
    },
  };
}

export type PublishAction = ReturnType<typeof usePublishAction>;

interface PublishButton {
  action: PublishAction;
  label: string;
  /** The label while the write runs. */
  busyLabel: string;
  busy: boolean;
  variant: "primary" | "secondary";
  /** Shown from `lg` up. */
  icon: ReactNode;
  /** The conditions this write still misses: the count on the button, which dims it while short.
   *  Left out, nothing is counted. */
  missing?: MissingField[];
  /** The `<form>` the button submits, so Enter in a field takes the same path (`form`'s
   *  `onSubmit` calls `action.attempt`). Left out, a click runs it. */
  form?: string;
  /** The panel an `ask` action opens under the button: its name and its content, which ends on
   *  the confirm that calls `action.confirmAsk`. */
  ask?: { label: string; content: ReactNode };
}

/** What a preset takes from a write: its action, whether it runs, and its live floor. */
type ButtonWrite = Pick<PublishButton, "action" | "busy" | "missing">;

/** The primary write that publishes a geolocation: *Publish geolocation* on the submit form,
 *  *Publish* on the edit form. */
export function publishGeolocationButton(
  { action, busy, missing }: ButtonWrite,
  label: string,
): PublishButton {
  return {
    action,
    busy,
    missing,
    label,
    busyLabel: PUBLISHING_LABEL,
    variant: "primary",
    icon: <MapPin size={14} strokeWidth={2} />,
  };
}

/** The secondary write that keeps the event a request: *Publish request* on the submit form,
 *  *Save request* on the edit form. */
export function requestWriteButton(
  { action, busy, missing }: ButtonWrite,
  label: string,
  busyLabel: string,
): PublishButton {
  return {
    action,
    busy,
    missing,
    label,
    busyLabel,
    variant: "secondary",
    icon: <Megaphone size={14} strokeWidth={2} />,
  };
}

/**
 * The pinned writes of an event form, the submit form's and the edit form's: one right-aligned
 * line of buttons, each with the count of what it still misses, then the `?` and `trailing` (the
 * edit form's close). A short button dims and stays clickable, so a click still flags the gaps.
 * An arming button reads *Confirm* on the first click, with `ARMED_RING`, and announces its
 * sentence in a live region; the second click writes. An asking button opens its panel on the
 * first click (`PopoverPanel`). The error banner follows the line. `lead` heads the block (a
 * review pass's position and Skip).
 */
export function PublishActions({
  buttons,
  help,
  helpFromSm = false,
  trailing,
  lead,
  error,
  disabled,
}: {
  buttons: PublishButton[];
  help?: Concept;
  /** Shows the `?` from `sm` up only, for a line with no room for it on a 320px phone. */
  helpFromSm?: boolean;
  trailing?: ReactNode;
  lead?: ReactNode;
  error?: string | null;
  /** Holds every button while a write runs. */
  disabled: boolean;
}) {
  const armed = buttons.find((b) => b.action.armed);
  return (
    <div className="space-y-3">
      {lead}
      <div className="flex items-center justify-end gap-2">
        {buttons.map((b) => {
          const missing = b.missing ?? [];
          const label = b.busy ? b.busyLabel : b.action.armed ? ARMED_LABEL : b.label;
          const asking = b.ask !== undefined && b.action.asking;
          return (
            <CountBadge key={b.label} count={missing.length} label={missingSummary(missing)}>
              {(describedBy) => (
                <>
                  <Button
                    ref={b.action.controlRef}
                    type={b.form ? "submit" : "button"}
                    form={b.form}
                    onClick={b.form ? undefined : b.action.attempt}
                    variant={b.variant}
                    disabled={disabled}
                    aria-label={label}
                    aria-describedby={describedBy}
                    aria-haspopup={b.ask ? "dialog" : undefined}
                    aria-expanded={b.ask ? asking : undefined}
                    className={cn(
                      "shrink-0 whitespace-nowrap",
                      missing.length > 0 && "opacity-60",
                      b.action.armed && ARMED_RING,
                      asking && ACCENT_SURFACE,
                    )}
                  >
                    <span aria-hidden className="contents max-lg:hidden">
                      {b.icon}
                    </span>
                    {/* Both labels share one grid cell, so arming never resizes the button. */}
                    <span aria-hidden className="grid">
                      <span className="invisible col-start-1 row-start-1">{b.label}</span>
                      {b.action.confirm && (
                        <span className="invisible col-start-1 row-start-1">{ARMED_LABEL}</span>
                      )}
                      <span className="col-start-1 row-start-1">{label}</span>
                    </span>
                  </Button>
                  {asking && (
                    <PopoverPanel
                      label={b.ask!.label}
                      anchorRef={b.action.controlRef}
                      onClose={b.action.cancelAsk}
                      align="end"
                    >
                      {b.ask!.content}
                    </PopoverPanel>
                  )}
                </>
              )}
            </CountBadge>
          );
        })}
        {/* Last on the line, the `?` keeps its phone tap area, 8px past its glyph, inside the
            line's right edge. */}
        {help && (
          <span className={cn("flex", helpFromSm && "max-sm:hidden", !trailing && "max-sm:pr-2")}>
            <FieldHelp concept={help} />
          </span>
        )}
        {trailing}
        <span className="sr-only" role="status" aria-live="polite">
          {armed?.action.confirm ?? ""}
        </span>
      </div>
      {error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { CountBadge } from "@/components/ui/CountBadge";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { ARMED_RING } from "@/components/ui/styles";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { cn } from "@/lib/cn";
import { missingSummary, type MissingField } from "@/lib/events";
import type { Concept } from "@/lib/fieldHelp";

/** What an armed button reads. */
const ARMED_LABEL = "Confirm publish";

/** One write of an event form. `attempt` runs `check` and, when it passes, the write: at once,
 *  or with `confirm` on the second click, since a publish makes the event public. */
export function usePublishAction({
  check,
  write,
  confirm,
}: {
  /** Flags what holds the write (missing fields, a running upload). True when it may go. */
  check: () => boolean;
  write: () => void;
  /** The armed button's sentence, for screen readers. Set, a first click arms. */
  confirm?: string;
}) {
  const { armed, trigger, cancel, controlRef } = useConfirmAction(write, {
    timeoutMs: ARM_MS,
    dismissOnOutside: true,
  });
  const attempt = () => {
    if (!check()) {
      cancel();
      return;
    }
    if (confirm) trigger();
    else write();
  };
  return { attempt, armed: confirm !== undefined && armed, controlRef, confirm };
}

export type PublishAction = ReturnType<typeof usePublishAction>;

export interface PublishButton {
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
}

/**
 * The pinned writes of an event form, the submit form's and the edit form's: one right-aligned
 * line of buttons, each with the count of what it still misses, then the `?` and `trailing`
 * (**More actions**). A short button dims and stays clickable, so a click still flags the gaps.
 * An arming button reads *Confirm publish* on the first click, with `ARMED_RING`, and announces its
 * sentence in a live region; the second click writes. The error banner follows the line. `lead`
 * heads the block (a review pass's position and Skip).
 */
export function PublishActions({
  buttons,
  help,
  trailing,
  lead,
  error,
  disabled,
}: {
  buttons: PublishButton[];
  help?: Concept;
  trailing?: ReactNode;
  lead?: ReactNode;
  error?: string | null;
  /** Holds every button while a write runs. */
  disabled: boolean;
}) {
  const armed = buttons.find((b) => b.action.armed);
  return (
    <aside aria-label="Actions" className="space-y-3">
      {lead}
      <div className="flex items-center justify-end gap-2">
        {buttons.map((b) => {
          const missing = b.missing ?? [];
          const label = b.busy ? b.busyLabel : b.action.armed ? ARMED_LABEL : b.label;
          return (
            <CountBadge key={b.label} count={missing.length} label={missingSummary(missing)}>
              {(describedBy) => (
                <Button
                  ref={b.action.controlRef}
                  type={b.form ? "submit" : "button"}
                  form={b.form}
                  onClick={b.form ? undefined : b.action.attempt}
                  variant={b.variant}
                  disabled={disabled}
                  aria-label={label}
                  aria-describedby={describedBy}
                  className={cn(missing.length > 0 && "opacity-60", b.action.armed && ARMED_RING)}
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
              )}
            </CountBadge>
          );
        })}
        {/* Last on the line, the `?` keeps its phone tap area, 8px past its glyph, inside the
            line's right edge. */}
        {help && (
          <span className={cn("flex", !trailing && "max-sm:pr-2")}>
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
    </aside>
  );
}

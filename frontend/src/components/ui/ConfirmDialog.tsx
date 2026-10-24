"use client";

import type { ReactNode } from "react";

import { Button } from "./Button";
import { Card } from "./Card";
import { FORM_ERROR_BANNER } from "./form-styles";
import { MediaOverlay } from "./MediaLightbox";

/**
 * A confirmation step before a final action: a centred dialog over the blurred page that says what
 * the action does, then **Cancel** and the confirm button. **Cancel** takes the initial focus, so
 * Enter on open sends nothing; **Cancel**, Escape and a click on the backdrop close it.
 *
 * The caller owns the open state and the request: `onConfirm` runs it, `busy` holds the buttons
 * while it is in flight, and `error` prints its refusal inside the dialog.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** What the action does and what cannot be undone. */
  children: ReactNode;
  confirmLabel: ReactNode;
  /** The confirm button's text while `busy`. */
  busyLabel?: ReactNode;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <MediaOverlay variant="dialog" label={title} onClose={busy ? () => {} : onCancel}>
      <Card className="w-[min(28rem,calc(100vw-3rem))] space-y-3 border-orange-500/40 text-sm">
        <h2 className="text-base font-semibold text-neutral-100">{title}</h2>
        <div className="space-y-2 text-neutral-400">{children}</div>
        {error && (
          <div className={FORM_ERROR_BANNER} role="alert">
            {error}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" data-overlay-close="" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
        </div>
      </Card>
    </MediaOverlay>
  );
}

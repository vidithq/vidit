"use client";

import type { ReactNode } from "react";

import { Button } from "./Button";
import { Card } from "./Card";
import { cn } from "@/lib/cn";
import { MediaOverlay } from "./MediaLightbox";
import { ErrorNotice } from "./ErrorNotice";
import type { ReadableError } from "@/lib/errors";

/**
 * A confirmation step before a final action: a centred dialog over the blurred page that says what
 * the action does, then **Cancel** and the confirm button. **Cancel** takes the initial focus, so
 * Enter on open sends nothing; **Cancel**, Escape and a click on the backdrop close it.
 *
 * The caller owns the open state and the request: `onConfirm` runs it, `busy` holds the buttons
 * while it is in flight, and `error` prints its refusal inside the dialog. `confirmDisabled` holds
 * the confirm button while an input the dialog carries is incomplete. `tone="danger"` paints the
 * border and the confirm red, for an action that deletes, removes or closes something.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  busy = false,
  confirmDisabled = false,
  error = null,
  tone = "accent",
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
  confirmDisabled?: boolean;
  error?: ReadableError | string | null;
  tone?: "accent" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <MediaOverlay variant="dialog" label={title} onClose={busy ? () => {} : onCancel}>
      <Card
        className={cn(
          "w-[min(28rem,calc(100vw-3rem))] space-y-3 text-sm",
          tone === "danger" ? "border-red-500/40" : "border-orange-500/40",
        )}
      >
        <h2 className="text-base font-semibold text-neutral-100">{title}</h2>
        <div className="space-y-2 text-neutral-400">{children}</div>
        {error && (
          <ErrorNotice error={error} />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" data-overlay-close="" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
        </div>
      </Card>
    </MediaOverlay>
  );
}

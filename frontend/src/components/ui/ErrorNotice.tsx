import { isValidElement, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import type { ReadableError } from "@/lib/errors";
import { ActionIcon, Button } from "./Button";

/**
 * The one error display above a form's actions or in place of a section. A fault the reader did
 * not cause (an error with a `title`: no answer, a server fault) leads with the title, explains
 * under it, and offers **Retry** when `onRetry` is set. Anything else, a string included, is one
 * line with no Retry, since running the same request again meets the same refusal. A message can
 * carry a link (the session-ended notice's way back), and `onDismiss` adds a cross that closes it.
 * Renders nothing for `null`.
 */
export function ErrorNotice({
  error,
  onRetry,
  onDismiss,
  className,
}: {
  error: ReadableError | ReactNode;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  if (error === null || error === undefined || error === "" || error === false) return null;
  const readable =
    typeof error === "object" && !isValidElement(error) && "message" in error
      ? (error as ReadableError)
      : null;
  const title = readable?.title ?? null;
  const message: ReactNode = readable ? readable.message : (error as ReactNode);
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-md border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm",
        className,
      )}
    >
      <CircleAlert size={16} className="mt-0.5 shrink-0 text-red-400" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        {title ? (
          <div className="space-y-0.5">
            <p className="text-neutral-100">{title}</p>
            <p className="text-neutral-400">{message}</p>
          </div>
        ) : (
          <p className="text-neutral-200">{message}</p>
        )}
        {title && onRetry && (
          <Button action="retry" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
      {onDismiss && (
        <Button icon variant="ghost" aria-label="Dismiss" onClick={onDismiss} className="-my-1.5 -mr-2">
          <ActionIcon action="remove" />
        </Button>
      )}
    </div>
  );
}

/** The refusal of one field, under it. Give it an `id` and point the field's
 *  `aria-describedby` at it, so a screen reader reads it with the field. `alert` announces it
 *  when it appears after an action (a submit, an upload), not while the reader types. */
export function FieldError({
  id,
  alert = false,
  children,
}: {
  id?: string;
  alert?: boolean;
  children: ReactNode;
}) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <p
      id={id}
      role={alert ? "alert" : undefined}
      className="flex items-start gap-1.5 text-xs text-red-400"
    >
      <CircleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

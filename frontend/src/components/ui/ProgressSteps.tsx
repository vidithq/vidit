import { Check, X } from "lucide-react";

import { ACCENT_SURFACE } from "./styles";

/** One step of a live multi-step operation. */
export interface ProgressStep {
  label: string;
  /** Live one-liner under the label while the step is active or failed
   *  (a percent, a counter, a failure hint). */
  detail?: string;
  /** 0..1 fills the active step's bar; omit for an indeterminate pulse. */
  progress?: number;
}

/**
 * Vertical stepper for a live multi-step operation (the archive import):
 * completed steps get a check, the active step a highlighted disc plus a
 * progress bar (determinate when `progress` exists, an indeterminate pulse
 * otherwise), pending steps stay muted. `active` is the running step's index;
 * pass `steps.length` when every step is complete. `failed` turns the active
 * step into the red failure marker (pair it with the form's error banner for
 * the message) and hides the bar.
 */
export function ProgressSteps({
  steps,
  active,
  failed = false,
}: {
  steps: ProgressStep[];
  active: number;
  failed?: boolean;
}) {
  return (
    <ol className="space-y-1" aria-label="Progress">
      {steps.map((step, i) => {
        const state =
          i < active ? "done" : i === active ? (failed ? "failed" : "active") : "pending";
        return (
          <li key={step.label} className="flex gap-3">
            {/* Marker column: the status disc + the connector to the next row. */}
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  state === "done"
                    ? "bg-orange-500/15 text-orange-400"
                    : state === "active"
                      ? `${ACCENT_SURFACE} ring-1 ring-orange-500/40`
                      : state === "failed"
                        ? "bg-red-500/10 text-red-400 ring-1 ring-red-500/40"
                        : "bg-neutral-800 text-neutral-500"
                }`}
                aria-hidden
              >
                {state === "done" ? (
                  <Check size={13} strokeWidth={2.5} />
                ) : state === "failed" ? (
                  <X size={13} strokeWidth={2.5} />
                ) : (
                  i + 1
                )}
              </span>
              {i < steps.length - 1 && (
                <span
                  className={`w-px flex-1 ${i < active ? "bg-orange-500/40" : "bg-neutral-800"}`}
                  aria-hidden
                />
              )}
            </div>
            <div className="min-w-0 flex-1 pb-3">
              <p
                className={`pt-1 text-sm ${
                  state === "active"
                    ? "text-neutral-100"
                    : state === "failed"
                      ? "text-red-300"
                      : state === "done"
                        ? "text-neutral-300"
                        : "text-neutral-500"
                }`}
              >
                {step.label}
              </p>
              {state === "active" && (
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-800"
                  role="progressbar"
                  aria-label={step.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    step.progress !== undefined
                      ? Math.round(step.progress * 100)
                      : undefined
                  }
                >
                  <div
                    className={`h-full rounded-full bg-orange-400/80 ${
                      step.progress === undefined ? "w-1/3 animate-pulse" : ""
                    }`}
                    style={
                      step.progress !== undefined
                        ? { width: `${Math.min(100, Math.max(0, step.progress * 100))}%` }
                        : undefined
                    }
                  />
                </div>
              )}
              {(state === "active" || state === "failed") && step.detail && (
                <p className="mt-1 text-xs text-neutral-500">{step.detail}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

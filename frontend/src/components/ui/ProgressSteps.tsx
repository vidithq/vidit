import { Check, Loader2, X } from "lucide-react";

import { ACCENT_SURFACE } from "./styles";

// Same disc shape as the guide list in ImportArchivePanel, kept inline on both
// sides because styles.ts is colour-only.
const NUMBER_DISC =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold";

export interface ProgressStep {
  label: string;
  /** One-liner under the label while the step is active or failed. */
  detail?: string;
  /** 0..1 fills a determinate bar. Pass it only for a real ratio (otherwise use
   *  `spinner`). */
  progress?: number;
  /** For an in-flight step with no measurable ratio. */
  spinner?: boolean;
  /** Keep the detail visible after the step completes. */
  keepDetail?: boolean;
}

const clampPct = (fraction: number) => Math.min(100, Math.max(0, Math.round(fraction * 100)));

/**
 * Vertical stepper for a live multi-step operation (the archive import):
 * completed steps get a check, the active step a highlighted disc plus a bar
 * (when `progress` exists) or `spinner`, pending steps stay muted. `active` is
 * the running step's index (`steps.length` when all are complete). `failed`
 * turns the active step red and hides the bar.
 *
 * Assistive tech gets `aria-current="step"`, a hidden state suffix per step, and
 * one polite status region.
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
  const activeStep = steps[active];
  const liveStatus = failed
    ? `${activeStep?.label ?? "Step"} failed`
    : activeStep
      ? `Step ${active + 1} of ${steps.length}: ${activeStep.label}` +
        (activeStep.progress !== undefined ? `, ${clampPct(activeStep.progress)}%` : "")
      : "All steps complete";
  return (
    <ol className="space-y-1" aria-label="Progress">
      <span role="status" className="sr-only">
        {liveStatus}
      </span>
      {steps.map((step, i) => {
        const state =
          i < active ? "done" : i === active ? (failed ? "failed" : "active") : "pending";
        return (
          // Positional key: steps never reorder and labels may repeat.
          <li key={i} className="flex gap-3" aria-current={state === "active" ? "step" : undefined}>
            <div className="flex flex-col items-center">
              <span
                className={`${NUMBER_DISC} ${
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
                className={`flex items-center gap-2 pt-1 text-sm ${
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
                <span className="sr-only">
                  {state === "done"
                    ? ", completed"
                    : state === "active"
                      ? ", in progress"
                      : state === "failed"
                        ? ", failed"
                        : ""}
                </span>
                {state === "active" && step.spinner && (
                  <Loader2
                    size={13}
                    strokeWidth={2}
                    className="shrink-0 animate-spin text-orange-400"
                    aria-hidden
                  />
                )}
              </p>
              {state === "active" && step.progress !== undefined && (
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-800"
                  role="progressbar"
                  aria-label={step.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={clampPct(step.progress)}
                >
                  <div
                    className="h-full rounded-full bg-orange-400/80"
                    style={{ width: `${clampPct(step.progress)}%` }}
                  />
                </div>
              )}
              {step.detail &&
                (state === "active" ||
                  state === "failed" ||
                  (state === "done" && step.keepDetail)) && (
                  <p className="mt-1 text-xs text-neutral-500">{step.detail}</p>
                )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

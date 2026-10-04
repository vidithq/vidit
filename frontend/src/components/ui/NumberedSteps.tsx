import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ACCENT_SURFACE } from "./styles";

/** One ordered instruction: a numbered disc, a title, and prose. `icon` is an
 *  optional glyph between the disc and the text. */
export type NumberedStep = {
  title: string;
  body?: ReactNode;
  icon?: LucideIcon;
};

/**
 * The "1, 2, 3" instruction list: an `<ol>` whose steps lead with a numbered disc.
 * Shared by the public guides (`/guide`, `/methodology`) and the archive export
 * walkthrough on `/submit`.
 *
 * Static reference copy: every step looks the same. For the live state of a
 * running operation (check marks, spinners), use `ProgressSteps`.
 */
export function NumberedSteps({
  steps,
  variant = "plain",
}: {
  steps: NumberedStep[];
  /** `plain`: bare rows (the guides). `boxed`: bordered cards with an accent
   *  disc (the archive walkthrough, inside a busier panel). */
  variant?: "plain" | "boxed";
}) {
  const boxed = variant === "boxed";
  return (
    <ol className={boxed ? "space-y-2" : "space-y-3 list-none"}>
      {steps.map(({ title, body, icon: Icon }, i) => (
        <li
          key={title}
          className={
            boxed
              ? "flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3"
              : "flex items-start gap-3"
          }
        >
          <span
            className={
              boxed
                ? `flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${ACCENT_SURFACE}`
                : "mt-0.5 size-6 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-[11px] text-neutral-400 font-medium shrink-0"
            }
          >
            {i + 1}
          </span>
          {Icon && (
            <Icon
              size={18}
              strokeWidth={1.8}
              className="mt-0.5 shrink-0 text-neutral-500"
            />
          )}
          <div className={boxed ? "min-w-0" : undefined}>
            <p
              className={
                boxed
                  ? "text-sm text-neutral-200"
                  : "text-sm font-medium text-neutral-100"
              }
            >
              {title}
            </p>
            {body !== undefined && (
              <div
                className={
                  boxed
                    ? "text-xs text-neutral-500"
                    : "text-xs text-neutral-400 mt-0.5 leading-relaxed"
                }
              >
                {body}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

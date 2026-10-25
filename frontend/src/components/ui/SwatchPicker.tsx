import { useRef, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";
import { ICON_TAP_STEP } from "./Button";

interface SwatchOption<T extends string> {
  value: T;
  /** The colour's name: the radio's accessible name and its hover title. */
  label: string;
  /** Any CSS colour. */
  color: string;
}

/**
 * Pick-one-colour field: a row of round swatches in an ARIA radiogroup. One swatch is the tab
 * stop (the selected one, or the first while none is); the arrow keys move between swatches
 * and select the one they land on, Home and End jump to the ends. The selected swatch wears a
 * light ring and the focused one an accent ring.
 *
 * A swatch is a 36px target below `sm` and a 24px disc from `sm` up.
 */
export function SwatchPicker<T extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  options: readonly SwatchOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((option) => option.value === value);
  const tabStop = selected === -1 ? 0 : selected;

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = options.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    refs.current[next]?.focus();
    if (next !== selected) onChange(options[next].value);
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => !active && onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            style={{ backgroundColor: option.color }}
            className={cn(
              // `ICON_TAP_STEP`: the phone floor for small icon controls (the swatch is a 24px disc).
              ICON_TAP_STEP,
              "sm:size-6 rounded-full outline-hidden transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900",
              active
                ? "ring-2 ring-neutral-100 ring-offset-2 ring-offset-neutral-900"
                : "ring-1 ring-neutral-700",
            )}
          />
        );
      })}
    </div>
  );
}

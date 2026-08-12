import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";
import { FORM_INVALID_FIELD } from "./form-styles";

// The one form field. `variant` picks the shape, `invalid` adds the red outline
// (the same FORM_INVALID_FIELD the section cards use). Native props + className
// pass through, so a caller keeps its per-field extras (font-mono, has-value,
// min-h, …). One component, the difference is a prop.
//
// - `default`: the standard field; focus turns the border orange (accent).
// - `compact`: denser, display-leaning data-row field (admin rows, trust reason).
// - `locked`: read-only inherited field (darker, `cursor-not-allowed`); pair
//   with `readOnly`.
export type InputVariant = "default" | "compact" | "locked";

const VARIANT: Record<InputVariant, string> = {
  default:
    "w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-hidden focus:border-orange-500",
  compact:
    "w-full px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-300",
  locked:
    "w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-neutral-400 text-sm cursor-not-allowed",
};

function fieldClass(
  variant: InputVariant,
  invalid: boolean,
  className: string,
): string {
  return cn(VARIANT[variant], invalid && FORM_INVALID_FIELD, className);
}

interface FieldProps {
  variant?: InputVariant;
  /** Red invalid outline (a field flagged by IncompleteFormNotice). */
  invalid?: boolean;
}

export function Input({
  variant = "default",
  invalid = false,
  icon,
  className = "",
  ...props
}: FieldProps & {
  /** Leading icon (e.g. a search glass), overlaid inside the field. */
  icon?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  if (icon) {
    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none">
          {icon}
        </span>
        <input
          className={cn(fieldClass(variant, invalid, ""), "pl-9", className)}
          {...props}
        />
      </div>
    );
  }
  return <input className={fieldClass(variant, invalid, className)} {...props} />;
}

/**
 * A pick-one-from-a-short-list field, the same shapes as `<Input>` (it runs the
 * same `fieldClass` recipe, so a select and a text field sit on one row without
 * drifting apart). Native `<select>` on purpose: the options are a handful of
 * curated values, and the platform control is the one that behaves correctly on
 * a phone. `appearance-none` plus the caret glyph keeps the arrow from rendering
 * as the browser default light chrome on the dark field.
 *
 * Pill chips stay the choice when the options are a taxonomy to browse (see
 * `<TagPicker>`); this is for a dense row where one column IS the choice.
 *
 * `className` sizes the field, same as on `<Input>`; it lands on the wrapper
 * the caret is positioned against, so a narrowing class keeps the arrow on the
 * control instead of stranding it at the far edge of the parent.
 */
export function Select({
  variant = "default",
  invalid = false,
  className = "",
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    // The caller's `className` sizes the WRAPPER, not the inner select: the
    // caret is positioned against this box, so a width landing on the select
    // alone would leave the arrow floating at the far end of a full-width
    // parent. The select then fills whatever width the wrapper was given.
    <div className={cn("relative", className)}>
      <select
        className={cn(
          fieldClass(variant, invalid, ""),
          "w-full appearance-none pr-8 cursor-pointer",
        )}
        {...props}
      >
        {children}
      </select>
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none text-[10px]">
        ▼
      </span>
    </div>
  );
}

export function Textarea({
  variant = "default",
  invalid = false,
  className = "",
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={fieldClass(variant, invalid, className)} {...props} />
  );
}

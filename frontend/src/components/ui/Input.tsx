import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";
import { FORM_INVALID_FIELD } from "./form-styles";

// The one form field. `variant` picks the shape, `invalid` adds the red outline
// (the same FORM_INVALID_FIELD the section cards use). Native props + className
// pass through, so a caller keeps its per-field extras (font-mono, has-value,
// min-h, …). Replaces the FORM_INPUT / FORM_INPUT_COMPACT / FORM_INPUT_LOCKED
// trio: one component, the difference is a prop.
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

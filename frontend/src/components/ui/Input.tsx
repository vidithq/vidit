import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";
import { FORM_INVALID_FIELD } from "./form-styles";

// The one form field. `variant` picks the shape, `invalid` adds the red outline.
// Native props + className pass through.
//
// - `default`: the standard field; focus turns the border orange.
// - `compact`: denser, display-leaning data-row field.
// - `locked`: read-only inherited field; pair with `readOnly`.
export type InputVariant = "default" | "compact" | "locked";

// 16px below `sm`, 14px from `sm` up. Mobile Safari zooms in on focus for any
// editable element under 16px and does not zoom back out on blur. Every field
// composed from these (`<Select>`, `<Textarea>`, the locked box) shares it.
export const FIELD_TEXT = "text-base sm:text-sm";

// The locked field's box, shared with `LockedUrl` (a link, not an input), which
// has to read as the same field. No `cursor-not-allowed` here: it is true of the
// input and false of the link, so the input adds it below.
export const LOCKED_FIELD = `w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-neutral-400 ${FIELD_TEXT}`;

// One field height across the variants (38px from `sm` up, 42px below): the
// ghost icon buttons in a field need the taller box to sit inside a gutter.
// `compact` keeps its quieter text and no focus accent.
const VARIANT: Record<InputVariant, string> = {
  default: `w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md ${FIELD_TEXT} text-neutral-100 placeholder:text-neutral-600 focus:outline-hidden focus:border-orange-500`,
  compact: `w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md ${FIELD_TEXT} text-neutral-300`,
  locked: `${LOCKED_FIELD} cursor-not-allowed`,
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
  /** Red outline (flagged by IncompleteFormNotice). */
  invalid?: boolean;
}

// Room for a `trailing` adornment: 6px inset plus two ghost icon buttons (32px
// from `sm` up, 36px below) and a 2px gap. One figure for every adornment, so
// text stops in the same place. Exported for `<LockedUrl>`, which renders an
// anchor and must clear the same adornment.
export const TRAILING_ROOM = "pr-20 sm:pr-18";

// Room for an adornment that stands down on a phone (`trailingFromSm`): one icon
// button from `sm` up, none below. At 320px the field is about 248px and a
// `datetime-local` needs more than the rest to paint its value.
const TRAILING_ROOM_FROM_SM = "sm:pr-10";

/** The adornment, positioned against a `relative` field box and centred on its
 *  height. Takes the pointer, since it holds controls. Shared with
 *  `<LockedUrl>`. */
export function FieldAdornment({
  children,
  className = "",
}: {
  children: ReactNode;
  /** `max-sm:hidden`, from a field whose mark stands down on a phone. */
  className?: string;
}) {
  return (
    <span
      className={cn(
        "absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The one form field.
 *
 * `icon` overlays a mark at the leading edge; `trailing` overlays content at the
 * trailing edge (a field's own actions, as ghost icon buttons) and, unlike
 * `icon`, takes the pointer.
 */
export function Input({
  variant = "default",
  invalid = false,
  icon,
  trailing,
  trailingFromSm = false,
  className = "",
  ...props
}: FieldProps & {
  icon?: ReactNode;
  /** Overlaid at the right edge; the text padding grows to clear it. */
  trailing?: ReactNode;
  /** Render the adornment and its room from `sm` up only. What it acts on must
   *  stay reachable without it (a date field falls back to the native picker). */
  trailingFromSm?: boolean;
  ref?: Ref<HTMLInputElement>;
} & InputHTMLAttributes<HTMLInputElement>) {
  if (icon || trailing) {
    return (
      // `w-full` so an adorned field fills its parent like a bare one. Size the
      // parent for another width.
      <div className="relative w-full">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none">
            {icon}
          </span>
        )}
        <input
          className={cn(
            fieldClass(variant, invalid, ""),
            icon && "pl-9",
            trailing && (trailingFromSm ? TRAILING_ROOM_FROM_SM : TRAILING_ROOM),
            className,
          )}
          {...props}
        />
        {trailing && (
          <FieldAdornment className={trailingFromSm ? "max-sm:hidden" : ""}>
            {trailing}
          </FieldAdornment>
        )}
      </div>
    );
  }
  return <input className={fieldClass(variant, invalid, className)} {...props} />;
}

/**
 * A pick-one-from-a-short-list field, on the same `fieldClass` recipe as
 * `<Input>`. Native `<select>`: the platform control behaves correctly on a
 * phone. `appearance-none` plus the caret glyph avoids the browser's default
 * light chrome. For a taxonomy to browse, use `<TagPicker>`.
 *
 * `className` lands on the wrapper the caret is positioned against, so a
 * narrowing class keeps the arrow on the control.
 */
export function Select({
  variant = "default",
  invalid = false,
  className = "",
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
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

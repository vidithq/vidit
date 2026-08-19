import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
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

// The locked field's box, on its own because an input is not the only thing
// that wears it: a locked URL renders its value as a link instead of an input
// (`LockedUrl`), and the two have to read as the same field. `cursor-not-allowed`
// is deliberately NOT part of the recipe. It says "you cannot act on this",
// which is true of the input and false of the link, so the input adds it below.
export const LOCKED_FIELD =
  "w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-neutral-400 text-sm";

// One field height across the three variants (`py-2` on a 20px line, so a 38px
// box): a field's own actions are ghost icon buttons, the same 32px square the
// rest of the site carries, and that square only sits inside a field with a
// gutter around it if every field is the taller box. A denser variant would put
// the same control in two sizes of field, which is the drift this avoids;
// `compact` keeps its quieter text and its missing focus accent, which is what
// made it a display-leaning row in the first place.
const VARIANT: Record<InputVariant, string> = {
  default:
    "w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-hidden focus:border-orange-500",
  compact:
    "w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-300",
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
  /** Red invalid outline (a field flagged by IncompleteFormNotice). */
  invalid?: boolean;
}

// The room a `trailing` adornment is given: the adornment's own inset from the
// field edge (6px) plus the width of the two ghost icon buttons the widest
// adornment carries (32px each with a 2px gap), which is 72px. Typed text stops
// here, so a value long enough to reach the edge runs under nothing. One figure
// for every adornment: a per-call-site padding is how two fields wearing the
// same mark end up with the text stopping in two different places. Exported for
// the one field that is not an `<input>`: `<LockedUrl>` renders its frozen value
// as an anchor and has to clear the same adornment by the same amount.
export const TRAILING_ROOM = "pr-18";

/** The adornment itself, positioned against a `relative` field box: centred on
 *  the field's height whatever height it takes, and taking the pointer, since
 *  what sits in it are controls. Each control is a ghost icon button carrying
 *  its own 32px square, which the 38px field clears with a 3px gutter, so the
 *  inset here is the room around that square rather than the field's text
 *  padding, and two of them sit a hair apart: their hover plates have to read as
 *  two controls without a channel of field between them. Shared with
 *  `<LockedUrl>` for the same reason `TRAILING_ROOM` is. */
export function FieldAdornment({ children }: { children: ReactNode }) {
  return (
    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5">
      {children}
    </span>
  );
}

/**
 * The one form field.
 *
 * `icon` overlays a mark at the leading edge (the search glass); `trailing`
 * overlays content at the trailing edge, vertically centred on the field
 * whatever height it takes. A trailing adornment is where a field's own actions
 * live: the map and copy marks of the longitude field, the picker of a date
 * field, the archive mark of a URL field. Each one is a ghost icon button
 * ([`<Button icon variant="ghost">`](./Button.tsx)), so an in-field control
 * reads as the same offer as every other icon control on the site.
 *
 * Unlike `icon`, `trailing` takes the pointer: the marks in it are controls.
 */
export function Input({
  variant = "default",
  invalid = false,
  icon,
  trailing,
  className = "",
  ...props
}: FieldProps & {
  /** Leading icon (e.g. a search glass), overlaid inside the field. */
  icon?: ReactNode;
  /** Content overlaid inside the field at its right edge, centred on the
   *  field's height. The field's text padding grows to clear it. */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
} & InputHTMLAttributes<HTMLInputElement>) {
  if (icon || trailing) {
    return (
      // `w-full`, so an adorned field fills its parent exactly as a bare one
      // does: the recipe's own `w-full` lands on the input, which a wrapper
      // sized by its content would then cap. A caller that needs another width
      // sizes the parent, as `<LinkListInput>`'s rows do.
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
            trailing && TRAILING_ROOM,
            className,
          )}
          {...props}
        />
        {trailing && <FieldAdornment>{trailing}</FieldAdornment>}
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

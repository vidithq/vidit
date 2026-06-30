import type { ButtonHTMLAttributes } from "react";

// The one button primitive: shape and colour in a single unit, so call sites
// never re-roll padding / sizing. `variant` picks the colour treatment; the
// shape is uniform (one size) by design, the single home if the button size
// ever changes. `fullWidth` stretches it (auth submits); pass orthogonal extras
// (margins, font-mono, an icon's own classes) via `className`.
//
// Replaces the PRIMARY_BUTTON / SECONDARY_BUTTON / NEUTRAL_BUTTON /
// DANGER_BUTTON / GHOST_BUTTON_* constants, which carried colour only and left
// every call site to hand-write the shape (the source of the size drift this
// removes). Defaults to `type="button"` so a button never submits a form by
// accident; pass `type="submit"` explicitly where it should.
// Two filled/outlined accent weights (primary, secondary), a neutral bordered
// button, a loud destructive (danger), and the two borderless "ghost" weights
// for dense row actions: neutral (ghost) and destructive (ghost-danger). The
// red ghost stays its own variant because the colour is a safety cue on
// revoke / delete; non-destructive row actions all share the one neutral ghost.
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "neutral"
  | "danger"
  | "ghost"
  | "ghost-danger";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-orange-500/10 text-orange-400 border border-orange-500/40 hover:bg-orange-500/20 hover:border-orange-500/60 hover:text-orange-300",
  secondary: "text-orange-400 hover:bg-orange-500/10 border border-orange-500/30",
  neutral:
    "bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100",
  danger: "bg-red-500 hover:bg-red-400 text-white",
  ghost: "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800",
  "ghost-danger": "text-red-300 hover:bg-red-500/10",
};

// The class string for the one button shape plus a variant's colour. `<Button>`
// applies it to a real `<button>`; a `<Link>` / `<a>` that should look like a
// button (a CTA that navigates) applies it directly, so a navigation control
// gets the same shape + colour without nesting a `<button>` inside an anchor.
export function buttonClasses(
  variant: ButtonVariant = "primary",
  { fullWidth = false, className = "" }: { fullWidth?: boolean; className?: string } = {},
): string {
  return `${BASE} ${VARIANT[variant]}${fullWidth ? " w-full" : ""}${
    className ? ` ${className}` : ""
  }`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  fullWidth = false,
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, { fullWidth, className })}
      {...props}
    />
  );
}

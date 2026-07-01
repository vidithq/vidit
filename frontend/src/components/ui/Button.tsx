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
// Four variants on two axes: tone (accent or danger) and emphasis (filled,
// outline, text). Everything clickable is the accent colour; red is only for
// destructive. There is no grey button (grey lives in the <Pill> neutral tone +
// disabled states), since a grey clickable reads as not-clickable.
//   primary    accent, filled    the one main action of a view
//   secondary  accent, outline   a secondary action
//   ghost      accent, text      quiet: cancel, dismiss, dense rows, icons
//   danger     red, outline      a destructive action (secondary, but red)
// The loud filled red is not an everyday variant: it is `DANGER_CONFIRM`, applied
// only to the armed second click of a two-click confirm, so the strongest red
// shows up once, at the point of no return.
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BASE =
  "inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-50";
// The text shape (the default) versus the square icon-only shape. `icon` keeps
// the same hover/colour treatment but drops the text padding for a compact
// square affordance (share, a × close), so a bare icon button doesn't have to
// re-roll its own size.
const TEXT_SHAPE = "gap-1.5 px-3 py-1.5 text-xs font-medium";
const ICON_SHAPE = "size-8";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-orange-500/10 text-orange-400 border border-orange-500/40 hover:bg-orange-500/20 hover:border-orange-500/60 hover:text-orange-300",
  secondary: "text-orange-400 hover:bg-orange-500/10 border border-orange-500/30",
  ghost: "text-orange-400 hover:bg-orange-500/10",
  danger: "text-red-400 hover:bg-red-500/10 border border-red-500/30",
};

// The one loud filled red, for the armed second click of a two-click confirm
// only. Applied via `className` (the `!` overrides the `danger` outline), so
// destructive triggers stay quiet and the strong red marks the point of no
// return: `<Button variant="danger" className={armed ? DANGER_CONFIRM : ""}>`.
export const DANGER_CONFIRM =
  "!bg-red-500 !border-red-500 !text-white hover:!bg-red-400";

// The class string for the one button shape plus a variant's colour. `<Button>`
// applies it to a real `<button>`; a `<Link>` / `<a>` that should look like a
// button (a CTA that navigates) applies it directly, so a navigation control
// gets the same shape + colour without nesting a `<button>` inside an anchor.
export function buttonClasses(
  variant: ButtonVariant = "primary",
  {
    fullWidth = false,
    icon = false,
    className = "",
  }: { fullWidth?: boolean; icon?: boolean; className?: string } = {},
): string {
  return `${BASE} ${icon ? ICON_SHAPE : TEXT_SHAPE} ${VARIANT[variant]}${
    fullWidth ? " w-full" : ""
  }${className ? ` ${className}` : ""}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** Square icon-only shape for a bare icon child (no text padding). */
  icon?: boolean;
}

export function Button({
  variant = "primary",
  fullWidth = false,
  icon = false,
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, { fullWidth, icon, className })}
      {...props}
    />
  );
}

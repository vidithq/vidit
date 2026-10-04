import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/cn";

// The one button primitive: shape and colour in one unit. `variant` picks the
// colour; the shape is uniform. `fullWidth` stretches it; pass other extras via
// `className`. Defaults to `type="button"`; pass `type="submit"` where needed.
//
// Five variants on two axes: tone (accent or danger) and emphasis (filled,
// outline, text). Clickable is accent; red is for destructive or alerting.
// There is no grey button, since grey reads as not-clickable (grey lives in the
// <Pill> neutral tone and the disabled state).
//   primary      accent, filled    the one main action of a view
//   secondary    accent, outline   a secondary action
//   ghost        accent, text      quiet: cancel, dismiss, dense rows, icons
//   danger       red, outline      a destructive action
//   dangerGhost  red, text         red at ghost weight, for an icon row (the
//                                  report flag)
// The loud filled red is `DANGER_CONFIRM`, for the armed second click of a
// two-click confirm only.
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "dangerGhost";

// Disabled is neutral grey, not a faded variant colour: colour means a control
// acts. The rules restate the hover treatments so they win over every variant's
// `hover:` (equal specificity, and `disabled:hover:` lands last).
const DISABLED =
  "disabled:cursor-not-allowed disabled:text-neutral-600 disabled:border-neutral-800 disabled:bg-transparent disabled:hover:bg-transparent disabled:hover:text-neutral-600 disabled:hover:border-neutral-800";

const BASE = `inline-flex items-center justify-center rounded-md transition-colors ${DISABLED}`;
// The text shape (default) versus the square icon-only shape (no text padding).
// Both step up on a phone, where the desktop 28px text button and 32px icon
// square are under what a thumb reliably hits. Only the tappable height grows.
// The phone tap step, shared by every control a thumb has to hit (an
// interactive `<Pill>`, a `<FilterSection>` header, quiet filter controls): 36px
// below `sm`, the exact desktop shape from `sm` up. Height only.
export const TAP_STEP = "min-h-9 sm:min-h-0";

// The same 36px floor for a square control smaller than the icon button that
// keeps its size on a desktop (settings swatch, `<FileManager>` remove, map
// scrubber controls, sidebar brand links). The caller names its desktop square
// beside it (`${ICON_TAP_STEP} sm:size-6`).
export const ICON_TAP_STEP = "size-9";

const TEXT_SHAPE = `gap-1.5 px-3 py-1.5 ${TAP_STEP} text-xs font-medium`;
const ICON_SHAPE = `${ICON_TAP_STEP} sm:size-8`;

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-orange-500/10 text-orange-400 border border-orange-500/40 hover:bg-orange-500/20 hover:border-orange-500/60 hover:text-orange-300",
  secondary: "text-orange-400 hover:bg-orange-500/10 border border-orange-500/30",
  ghost: "text-orange-400 hover:bg-orange-500/10",
  danger: "text-red-400 hover:bg-red-500/10 border border-red-500/30",
  dangerGhost: "text-red-400 hover:bg-red-500/10",
};

// The armed second click of a two-click confirm only. The `!` overrides the
// `danger` outline: `<Button variant="danger" className={armed ? DANGER_CONFIRM : ""}>`.
export const DANGER_CONFIRM =
  "!bg-red-500 !border-red-500 !text-white hover:!bg-red-400";

// The button shape plus a variant's colour, for a `<Link>` / `<a>` that should
// look like a button without nesting a `<button>` in an anchor.
export function buttonClasses(
  variant: ButtonVariant = "primary",
  {
    fullWidth = false,
    icon = false,
    className = "",
  }: { fullWidth?: boolean; icon?: boolean; className?: string } = {},
): string {
  return cn(
    BASE,
    icon ? ICON_SHAPE : TEXT_SHAPE,
    VARIANT[variant],
    fullWidth && "w-full",
    className,
  );
}

// `ComponentPropsWithRef` so a caller can pass `ref` to measure or focus the
// real button.
interface ButtonProps extends ComponentPropsWithRef<"button"> {
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

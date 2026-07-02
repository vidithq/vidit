import { cn } from "@/lib/cn";

/**
 * The one boolean toggle. Settings ("show help tooltips") and the map filter
 * rows each hand-rolled their own track + knob with drifted paints (solid vs
 * tinted accent, two knob greys); the paints live here once.
 *
 * A `<button role="switch">` by default. Pass `as="span"` when a parent
 * control owns the click (e.g. the map filter's whole-row toggle) and the
 * switch is purely the visual state: the span is `aria-hidden`, the parent
 * carries `role="switch"` + `aria-checked`.
 */
export function Switch({
  on,
  onToggle,
  size = "md",
  as = "button",
  "aria-label": ariaLabel,
}: {
  on: boolean;
  /** Required in button mode; ignored with `as="span"`. */
  onToggle?: () => void;
  /** `md`: settings rows; `sm`: dense filter rows. */
  size?: "sm" | "md";
  as?: "button" | "span";
  "aria-label"?: string;
}) {
  const track = cn(
    "relative inline-flex shrink-0 items-center rounded-full transition-colors",
    size === "md" ? "h-5 w-9" : "h-4 w-7",
    on ? "bg-orange-500/60" : "bg-neutral-700",
  );
  const knob = cn(
    "inline-block transform rounded-full bg-neutral-100 transition-transform",
    size === "md" ? "size-4" : "size-3",
    on
      ? size === "md"
        ? "translate-x-[18px]"
        : "translate-x-[14px]"
      : "translate-x-0.5",
  );
  if (as === "span") {
    return (
      <span aria-hidden="true" className={track}>
        <span className={knob} />
      </span>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={track}
    >
      <span className={knob} />
    </button>
  );
}

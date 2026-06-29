import type { ElementType, ReactNode } from "react";

// Panel / section card: the `bg-neutral-900 rounded-lg border border-neutral-700
// p-5` shell that wrapped every settings, admin, profile, and form section by
// hand. Colour + shape live here once; callers pass their own content and the
// vertical rhythm via `spacing`. Shapes that read as list rows (the denser
// `border-neutral-800 rounded-md` tone) are a separate treatment, not this.

// Literal class names so Tailwind's JIT scanner still sees them (a computed
// `space-y-${n}` would never be generated).
const SPACING = {
  "0": "",
  "2": "space-y-2",
  "3": "space-y-3",
  "4": "space-y-4",
  "5": "space-y-5",
} as const;

export function Card({
  as: Tag = "div",
  spacing = "3",
  className = "",
  children,
}: {
  as?: ElementType;
  spacing?: keyof typeof SPACING;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={`bg-neutral-900 rounded-lg border border-neutral-700 p-5 ${SPACING[spacing]} ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}

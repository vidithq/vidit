import type { ElementType, ReactNode } from "react";

// Panel / section card: the `bg-neutral-900 rounded-lg border border-neutral-700
// p-5` shell that wrapped every settings, admin, profile, and form section by
// hand. Colour + shape live here once; callers pass their own content. One
// vertical rhythm (`space-y-4`) for every card, so the inter-row density can't
// drift call-site to call-site. Shapes that read as list rows (the denser
// `border-neutral-800 rounded-md` tone) are a separate treatment, not this.
export function Card({
  as: Tag = "div",
  className = "",
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={`bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4 ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}

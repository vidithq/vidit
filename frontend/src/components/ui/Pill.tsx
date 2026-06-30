import type { ReactNode } from "react";

// The one badge/pill shape for the whole family (status, lifecycle, tag): a
// `rounded-full` chip at a single size and weight. Only `tone` (the colour
// classes: bg + text + optional border) and an optional leading `icon` vary
// per use, so the badges read as one language instead of three. Consumers:
// StatusBadge, BountyStatusBadge, TagBadge.
export function Pill({
  tone,
  icon,
  title,
  className = "",
  children,
}: {
  /** Colour classes (background, text, and optional border). */
  tone: string;
  icon?: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tone} ${className}`.trim()}
    >
      {icon}
      {children}
    </span>
  );
}

import type { ReactNode } from "react";

// Boxed empty-state: the muted, centered "nothing here yet" panel used by list
// pages (search, bounties). Often carries an inline `TEXT_LINK` CTA as children.
export function EmptyState({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-sm text-neutral-500 bg-neutral-900 border border-neutral-800 rounded-md p-6 text-center ${className}`.trim()}
    >
      {children}
    </div>
  );
}

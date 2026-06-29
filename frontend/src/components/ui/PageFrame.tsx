import type { ReactNode } from "react";

// The shared page frame: clears the fixed sidebar rail (pl-14) and centres
// content in one column (max-w-4xl mx-auto px-6), so every page lands at the
// same left inset. Vertical rhythm is the caller's: PageShell layers its header
// spacing on top, the public landing its hero/section padding. No "use client"
// here, so the SEO landing (a server component) can use it directly, and
// PageShell (client, for its back button) composes it too. Single source of
// truth for the offset + content column; change the column in one place.
export function PageFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-screen pl-14">
      <div className={`max-w-4xl mx-auto px-6 ${className}`}>{children}</div>
    </div>
  );
}

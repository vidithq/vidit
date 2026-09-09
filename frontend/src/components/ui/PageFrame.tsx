import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

// The shared page frame: clears the fixed nav chrome and centres content in one
// column (max-w-4xl mx-auto px-4 sm:px-6), so every page lands at the same
// inset. The chrome moves at `sm`, so the offset does too: from `sm` up the rail
// is a fixed 56px column on the left (sm:pl-14); below it the rail is a drawer
// behind a floating menu chip in the top-left corner, which takes no inset of
// its own: the caller's top padding clears it (PageShell's `max-sm:pt-16`, the
// landing's hero padding). Vertical rhythm is the caller's: PageShell layers its
// header spacing on top, the public landing its hero/section padding. No "use
// client" here, so the SEO landing (a server component) can use it directly,
// and PageShell (client, for its back button) composes it too. Single source of
// truth for the offset + content column; change the column in one place.
// Why the side padding takes a step at `sm`: docs/design.md → Page chrome.
export function PageFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-screen sm:pl-14">
      {/* `cn` and not a template string, so a caller's own `px-*` replaces the
          column padding instead of landing beside it. */}
      <div className={cn("max-w-4xl mx-auto px-4 sm:px-6", className)}>
        {children}
      </div>
    </div>
  );
}

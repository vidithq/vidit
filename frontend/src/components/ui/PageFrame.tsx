import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

// The shared page frame: clears the fixed nav chrome and centres content in one
// column (max-w-4xl mx-auto px-4 sm:px-6). From `sm` up the rail is a fixed 56px
// column (sm:pl-14); below it the rail is a drawer behind a floating chip that
// takes no inset of its own: the caller's top padding clears it (PageShell's
// `max-sm:pt-16`, the landing's hero padding). Vertical rhythm is the caller's.
// No "use client", so the SEO landing (a server component) can use it. This file
// is the only place `sm:pl-14` is written (here and in `PageCenter`).
// Why the side padding steps at `sm`: docs/design.md, Page chrome.

// The display cutout's horizontal insets, applied once for every route.
// `app/layout.tsx` exports `viewportFit: "cover"`, so in landscape on a notched
// phone the column would start under the cutout. Its own element because every
// box below carries padding on the same sides, which would decide the winner by
// stylesheet order. `env()` reads 0 with no inset, so it is inert on a desktop.
const SAFE_SIDES = "safe-pl safe-pr";

// `dvh`, like every surface that owns the screen size. `vh` is the tallest the
// viewport gets, so with mobile Safari's URL bar showing, a centred block
// (`PageCenter`, the auth screens) sits below the visible middle and its last
// row sits behind the bottom chrome; a column frame gains dead scroll.
const MIN_HEIGHT = "min-h-dvh";

export function PageFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${MIN_HEIGHT} sm:pl-14`}>
      <div className={SAFE_SIDES}>
        {/* `cn`, so a caller's `px-*` replaces the column padding. */}
        <div className={cn("max-w-4xl mx-auto px-4 sm:px-6", className)}>
          {children}
        </div>
      </div>
    </div>
  );
}

// One centred block on the same rail offset, for a single-state screen (loading
// and error states, the auth screens, the error boundary). `className` carries
// the caller's paint; `cn` lets it replace what it names.
export function PageCenter({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        `${MIN_HEIGHT} sm:pl-14 flex items-center justify-center`,
        className,
      )}
    >
      <div className={SAFE_SIDES}>{children}</div>
    </div>
  );
}

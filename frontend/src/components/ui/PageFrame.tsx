import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

// The shared page frame: clears the fixed nav chrome and holds the content
// column. From `sm` up the rail is a fixed 56px column (sm:pl-14); below it the
// rail is a drawer behind a floating chip that takes no inset of its own: the
// caller's top padding clears it (PageShell's `max-sm:pt-16`, the landing's hero
// padding). Vertical rhythm is the caller's.
// No "use client", so the SEO landing (a server component) can use it. This file
// is the only place `sm:pl-14` is written (here and in `PageCenter`).
// Why the side padding steps at `sm`: docs/design.md, Page chrome.
//
// `column` picks the width. `wide` and `reading` are the app container every
// `PageShell` page shares. From `lg` up, `COLUMN_GUTTER` centres a `max-w-6xl`
// column on the screen with the rail counted in the left margin: half the box
// inside the rail, less half the column and half the 3.5rem rail. `reading`
// takes the same gutter, so the content's left edge sits at one x on every
// page. The gutter never drops below 4.5rem (`pl-18`), the room PageShell's
// back arrow parks in from `lg` up. `wide` holds up to `max-w-6xl` of content,
// for a page with a right rail. `reading` holds 53rem, the content width the
// centred column leaves inside its `sm:px-6`, so a page without a rail keeps
// its line length. `center` is the landing's centred `max-w-4xl` column.

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

const COLUMN_WIDTH = { wide: "max-w-6xl", reading: "max-w-[53rem]" } as const;

// A percentage padding resolves against the box inside the rail and the safe
// insets, not `100vw`, which counts a classic scrollbar and would shift the
// column off centre.
const COLUMN_GUTTER = "lg:pl-[max(4.5rem,calc(50%-var(--container-6xl)/2-1.75rem))]";

export function PageFrame({
  children,
  className = "",
  column = "center",
}: {
  children: ReactNode;
  className?: string;
  column?: "center" | "reading" | "wide";
}) {
  return (
    <div className={`${MIN_HEIGHT} sm:pl-14`}>
      <div className={SAFE_SIDES}>
        {column !== "center" ? (
          <div className={`px-4 sm:px-6 ${COLUMN_GUTTER}`}>
            <div className={cn(COLUMN_WIDTH[column], className)}>{children}</div>
          </div>
        ) : (
          // `cn`, so a caller's `px-*` replaces the column padding.
          <div className={cn("max-w-4xl mx-auto px-4 sm:px-6", className)}>
            {children}
          </div>
        )}
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

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

// The shared page frame: clears the fixed nav chrome and centres content in one
// column (max-w-4xl mx-auto px-4 sm:px-6), so every page lands at the same
// inset. The chrome moves at `sm`, so the offset does too: from `sm` up the rail
// is a fixed 56px column on the left (sm:pl-14); below it the rail is a drawer
// behind a floating chip in the top-left corner (about 50px square at an 8px
// inset), which takes no inset of its own: the caller's top padding clears it
// (PageShell's `max-sm:pt-16`, the landing's hero padding). Vertical rhythm is
// the caller's: PageShell layers its header spacing on top, the public landing
// its hero/section padding. No "use client" here, so the SEO landing (a server
// component) can use it directly, and PageShell (client, for its back button)
// composes it too. Single source of truth for the rail offset + content column:
// this file is the only place `sm:pl-14` is written, here for a page with a
// column and in `PageCenter` below for one centred block.
// Why the side padding takes a step at `sm`: docs/design.md → Page chrome.

// The display cutout's horizontal insets, applied once for every route rather
// than per page. `app/layout.tsx` exports `viewportFit: "cover"`, so in
// landscape on a notched phone the content column would otherwise start under
// the cutout; the chrome that sits on a screen edge already takes its own
// insets, and this is the same move for the column both frames centre. Its own
// element because the insets are padding and every box below already carries a
// padding utility on the same sides, which would decide the winner by
// stylesheet order rather than by intent. `env()` reads 0 with no inset
// reported, so the element is inert on a desktop.
const SAFE_SIDES = "safe-pl safe-pr";

// The frame's own height floor, on `dvh` like every other surface that owns the
// screen size (the map page, the media lightbox, the global error boundary).
// `vh` is the tallest the viewport ever gets, so with mobile Safari's URL bar
// showing, an 812px screen frames 812px of page inside 712px of visible room:
// a centred block (`PageCenter`, which is what the auth screens are) is then
// centred 50px below the middle of what the reader can see, and its last row,
// the sign-in button and the legal line under it, sits behind the bottom
// chrome. A column frame gains the same 100px of dead scroll under its
// content. `dvh` tracks the room that is actually visible.
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
        {/* `cn` and not a template string, so a caller's own `px-*` replaces the
            column padding instead of landing beside it. */}
        <div className={cn("max-w-4xl mx-auto px-4 sm:px-6", className)}>
          {children}
        </div>
      </div>
    </div>
  );
}

// One centred block on the same rail offset, for a screen that is a single
// state rather than a column: the loading and error states below `PageShell`
// (reached through `PageLoading` / `PageError`), the auth screens, the error
// boundary. `className` carries the caller's own paint (a background, a text
// colour, side padding); `cn` lets it replace what it names.
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

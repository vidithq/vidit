"use client";

import { usePathname } from "next/navigation";
import { isAuthRoute } from "@/lib/auth-routes";
import { Pill } from "@/components/ui/Pill";

// Baked into the bundle by next.config.mjs — the deploy ref's
// `git describe --tags --always --dirty`, or "dev" with no git history. See
// next.config.mjs > resolveBuildVersion.
const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION || "dev";

// Tag-derived versions start with a digit — prefix those with "v". The "dev"
// fallback and bare commit SHAs render verbatim; they aren't versions.
const displayVersion = /^\d/.test(BUILD_VERSION)
  ? `v${BUILD_VERSION}`
  : BUILD_VERSION;

const REPORT_URL = "https://discord.gg/9wPtsrrKyJ";

// The floating corner pill would sit over a phone's content, so it hides below
// `sm` and the nav drawer renders this same component with `inline` instead.
// One wrapper, one pill: only the placement classes differ, and the two
// visibility halves never overlap, so exactly one copy is live at any width.
const WRAPPER_CLASS = {
  corner:
    "max-sm:hidden fixed bottom-3 right-3 z-1200 pointer-events-none select-none",
  inline: "sm:hidden select-none",
};

export default function BetaBanner({ inline = false }: { inline?: boolean }) {
  const pathname = usePathname() ?? "";
  if (isAuthRoute(pathname)) return null;
  // The landing dropped its beta framing, so the corner pill follows it there;
  // it stays on every app surface.
  if (pathname === "/") return null;
  return (
    // `pointer-events-none` on the corner copy so the badge never eats map
    // drags; only the report link inside opts back in. The wrapper owns the
    // placement, the <Pill> owns the look.
    <div
      role="status"
      aria-label="Beta"
      className={inline ? WRAPPER_CLASS.inline : WRAPPER_CLASS.corner}
    >
      <Pill tone="accent" className="gap-2 tracking-tight backdrop-blur-xs">
        <span>Beta · {displayVersion}</span>
        <a
          href={REPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Report a bug in our Discord"
          className="pointer-events-auto text-orange-300 hover:text-orange-100 transition-colors border-l border-orange-500/30 pl-2 -mr-0.5"
        >
          Report a bug
        </a>
      </Pill>
    </div>
  );
}

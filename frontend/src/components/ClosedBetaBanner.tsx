"use client";

import { usePathname } from "next/navigation";
import { isAuthRoute } from "@/lib/auth-routes";
import { BETA_PILL } from "@/components/ui/styles";

// Baked into the bundle by next.config.mjs — resolves to the deploy ref's
// `git describe --tags --always --dirty`, or "dev" if no git history is
// available at build time. See next.config.mjs > resolveBuildVersion.
const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION || "dev";

// Tag-derived versions start with a digit (e.g. "0.0.1", "0.0.1-28-gabc123");
// prefix those with "v" for display. The "dev" fallback and bare commit
// SHAs render verbatim — they aren't versions.
const displayVersion = /^\d/.test(BUILD_VERSION)
  ? `v${BUILD_VERSION}`
  : BUILD_VERSION;

const REPORT_URL = "https://discord.gg/9wPtsrrKyJ";

export default function ClosedBetaBanner() {
  const pathname = usePathname() ?? "";
  if (isAuthRoute(pathname)) return null;
  return (
    // Wrapper is `pointer-events-none` so the badge never eats map drags
    // or clicks. Only the report link inside opts back into pointer events,
    // since it actually needs to be clickable.
    <div
      role="status"
      aria-label="Closed beta"
      className={`fixed bottom-3 right-3 z-[1200] inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-medium tracking-tight pointer-events-none select-none backdrop-blur-sm ${BETA_PILL}`}
    >
      <span className="size-1.5 rounded-full bg-orange-500" />
      <span>Closed beta · {displayVersion}</span>
      <a
        href={REPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Report a problem in our Discord"
        className="pointer-events-auto text-orange-300 hover:text-orange-100 transition-colors border-l border-orange-500/30 pl-2 -mr-0.5"
      >
        Report a problem
      </a>
    </div>
  );
}

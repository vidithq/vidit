"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { setPreviousInternalPath } from "@/lib/navigation";

/**
 * Records the previous same-origin pathname into sessionStorage on each route
 * change, so `smartBack` (in `lib/navigation.ts`) can land the user back on it.
 * Mounted once at the root via `Providers`. Side-effect only — renders nothing.
 */
export default function PathTracker() {
  const pathname = usePathname();
  const previousRef = useRef<string | null>(null);

  useEffect(() => {
    // Stamp the *previous* pathname (still in the ref), not the current one:
    // by the time `smartBack` fires, the current path is the page being left.
    if (previousRef.current && previousRef.current !== pathname) {
      setPreviousInternalPath(previousRef.current);
    }
    previousRef.current = pathname;
  }, [pathname]);

  return null;
}

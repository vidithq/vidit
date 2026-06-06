"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { setPreviousInternalPath } from "@/lib/navigation";

/**
 * Records the previous same-origin pathname into sessionStorage on
 * every Next.js route change, so `smartBack` (in `lib/navigation.ts`)
 * can land the user back on it. Mounted once at the root via
 * `Providers`.
 *
 * Renders nothing — this is purely a side-effect.
 */
export default function PathTracker() {
  const pathname = usePathname();
  const previousRef = useRef<string | null>(null);

  useEffect(() => {
    // First render: nothing to remember yet. Subsequent renders: the
    // *previous* pathname (still in the ref) is the one we want to
    // stamp, because by the time `smartBack` is invoked the current
    // pathname is the page the user wants to leave.
    if (previousRef.current && previousRef.current !== pathname) {
      setPreviousInternalPath(previousRef.current);
    }
    previousRef.current = pathname;
  }, [pathname]);

  return null;
}

"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { recordNavigation } from "@/lib/navigation";

/**
 * Pushes the same-origin pathname being left onto the `smartBack` back-stack
 * (in `lib/navigation.ts`) on each route change. Mounted once at the root via
 * `Providers`. Side-effect only — renders nothing.
 */
export default function PathTracker() {
  const pathname = usePathname();
  const previousRef = useRef<string | null>(null);

  useEffect(() => {
    // Record the *previous* pathname (still in the ref), not the current one:
    // it's the page being left. `recordNavigation` no-ops when the change was a
    // `smartBack` pop, so the back walk doesn't re-grow the stack.
    if (previousRef.current && previousRef.current !== pathname) {
      recordNavigation(previousRef.current);
    }
    previousRef.current = pathname;
  }, [pathname]);

  return null;
}

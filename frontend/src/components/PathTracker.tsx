"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { recordNavigation } from "@/lib/navigation";

/** Pushes the same-origin pathname being left onto the `smartBack` back-stack
 * (`lib/navigation.ts`) on each route change. Mounted once at the root via `Providers`. Renders
 * nothing. */
export default function PathTracker() {
  const pathname = usePathname();
  const previousRef = useRef<string | null>(null);

  useEffect(() => {
    // Record the previous pathname (still in the ref): the page being left. `recordNavigation` no-ops
    // on a `smartBack` pop, so the back walk doesn't regrow the stack.
    if (previousRef.current && previousRef.current !== pathname) {
      recordNavigation(previousRef.current);
    }
    previousRef.current = pathname;
  }, [pathname]);

  return null;
}

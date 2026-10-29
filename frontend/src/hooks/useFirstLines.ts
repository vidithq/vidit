"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Keeps a wrapping row to its first `lines` lines: measures where its children wrap and returns
 * the index of the first child past those lines (`cut`, the child count when all fit) and the
 * height those lines take. The caller hides the children from `cut` on and caps its height, so
 * the row stays laid out and the measure holds as the width changes.
 */
export function useFirstLines<T extends HTMLElement>(lines: number, key: string) {
  const ref = useRef<T>(null);
  const [fit, setFit] = useState<{ cut: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const measure = () => {
      const kids = [...row.children] as HTMLElement[];
      const tops = [...new Set(kids.map((k) => k.offsetTop))].sort((a, b) => a - b);
      const last = tops[lines - 1] ?? Infinity;
      const index = kids.findIndex((k) => k.offsetTop > last);
      const cut = index === -1 ? kids.length : index;
      const height = Math.max(0, ...kids.slice(0, cut).map((k) => k.offsetTop + k.offsetHeight));
      setFit((prev) => (prev?.cut === cut && prev.height === height ? prev : { cut, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [lines, key]);

  return { ref, cut: fit?.cut ?? Infinity, height: fit && fit.height > 0 ? fit.height : undefined };
}

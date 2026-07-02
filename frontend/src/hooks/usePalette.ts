"use client";

import { useSyncExternalStore } from "react";
import {
  getPalette,
  DEFAULT_PALETTE,
  PALETTE_EVENT,
  type PaletteId,
} from "@/lib/palette";

function subscribe(callback: () => void): () => void {
  window.addEventListener(PALETTE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(PALETTE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * The selected accent palette. `useSyncExternalStore` keeps the settings picker
 * and the map markers in sync, and its server snapshot (`DEFAULT_PALETTE`)
 * matches the pre-paint inline script in the root layout, so there's no
 * hydration mismatch.
 */
export function usePalette(): PaletteId {
  return useSyncExternalStore(subscribe, getPalette, () => DEFAULT_PALETTE);
}

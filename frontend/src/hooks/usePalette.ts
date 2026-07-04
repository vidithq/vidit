"use client";

import { useClientPreference } from "./useClientPreference";
import { getPalette, DEFAULT_PALETTE, PALETTE_EVENT, type PaletteId } from "@/lib/palette";

/**
 * The selected accent palette. Kept in sync across the settings picker and the
 * map markers; the server snapshot (`DEFAULT_PALETTE`) matches the pre-paint
 * inline script in the root layout, so there's no hydration mismatch.
 */
export function usePalette(): PaletteId {
  return useClientPreference(getPalette, PALETTE_EVENT, () => DEFAULT_PALETTE);
}

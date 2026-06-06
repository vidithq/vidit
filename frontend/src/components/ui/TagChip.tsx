"use client";

import type { Tag } from "@/types";
import { FILTER_CHIP_ACTIVE, FILTER_CHIP_INACTIVE } from "@/components/ui/styles";

/**
 * Selectable tag pill used across the submit forms (geolocation + bounty)
 * and anywhere a toggleable tag chip is needed. Orange when active per the
 * palette rule (clickable ⇒ orange); neutral when inactive. Shape lives
 * here, colour comes from the shared palette constants.
 */
export function TagChip({
  tag,
  active,
  onClick,
}: {
  tag: Tag;
  active: boolean;
  onClick: () => void;
}) {
  const base = "px-3 py-1 rounded-full text-xs font-medium transition-colors";
  const activeClass = active ? FILTER_CHIP_ACTIVE : FILTER_CHIP_INACTIVE;
  return (
    <button type="button" onClick={onClick} className={`${base} ${activeClass}`}>
      {tag.name}
    </button>
  );
}

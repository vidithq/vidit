import type { Conflict } from "@/types";

// The conflict escape row's name. Hand-kept FE-BE mirror (backend: migration
// `j2l4n6p8r0t2` `CONFLICT_ESCAPE_NAME`, `services/seed.py`
// `CONFLICT_OTHER_NAME`); change together.
export const CONFLICT_OTHER_NAME = "Other";

/**
 * Display label for a conflict: the name plus its years. Ongoing entries read
 * "Name (2014-present)", ended ones "Name (1982)" or "Name (1990-1991)".
 * Two guards skip the suffix: no known start year, and names that already
 * carry a 4-digit year (Wikipedia names like "Haitian crisis (2018–present)"
 * would otherwise render their years twice). Years are rendered here, never
 * baked into the stored name.
 */
export function conflictLabel(c: Conflict): string {
  if (c.start_year === null || /\d{4}/.test(c.name)) return c.name;
  const end = c.ongoing ? "present" : c.end_year;
  const suffix =
    end === null || end === c.start_year
      ? `${c.start_year}`
      : `${c.start_year}-${end}`;
  return `${c.name} (${suffix})`;
}

// Wikipedia death-toll tier ranking; rows without a tier (historical or
// manual entries) sort after all tiered ones.
const TIER_RANK: Record<NonNullable<Conflict["tier"]>, number> = {
  major: 0,
  minor: 1,
  conflict: 2,
};

/**
 * Referential display order: tier rank (major < minor < conflict < none),
 * then name alphabetically. The "Other" escape row is pinned last no matter
 * its tier or the active filters. The server orders ongoing-then-name, so
 * this is computed client-side. Returns a new array.
 */
export function sortConflicts(list: Conflict[]): Conflict[] {
  return [...list].sort((a, b) => {
    const aOther = a.name === CONFLICT_OTHER_NAME;
    const bOther = b.name === CONFLICT_OTHER_NAME;
    if (aOther !== bOther) return aOther ? 1 : -1;
    const rank =
      (a.tier === null ? 3 : TIER_RANK[a.tier]) -
      (b.tier === null ? 3 : TIER_RANK[b.tier]);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
}

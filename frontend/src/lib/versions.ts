import type { components } from "./api-types";

type Author = components["schemas"]["AuthorRef"];

/** What the version selector, the history rows and the version banner need of a versioned
 *  record (an event, a site): its live and first numbers, the name of each version and where
 *  each one opens. The live version opens the record's own page. */
export interface VersionedRecord {
  latest: number;
  first: number;
  label: (number: number) => string;
  href: (number: number) => string;
  historyHref: string;
}

/** One version as a history surface lists it, described by the write that produced it. */
export interface VersionEntry<View> {
  number: number;
  /** True for the live version, the one the record's page serves. */
  current: boolean;
  /** The record at this version, or `null` when redacted. */
  view: View | null;
  /** Who produced this version and when; `null` when the carrying row could not be read. */
  editor: Author | null;
  createdAt: string | null;
  /** The editor's own words about the edit, `null` when they left none. */
  note: string | null;
  redacted: boolean;
  /** Fields changed against the previous version; `null` when not comparable (the first
   *  version, or a redacted side). */
  changed: string[] | null;
}

/** The rows of one version in a history walk: `own` holds its content (absent for the live
 *  version) and `below`, the row one lower, holds the byline of the write that produced it,
 *  since the API files a write's byline on the version it superseded, and the diff base. */
export interface VersionStep<Row> {
  number: number;
  own: Row | undefined;
  below: Row | undefined;
}

/** The versions of a history walk newest first. While `hasMore`, the oldest loaded row is only
 *  the byline of the version above it, so the walk stops one above it until the page that
 *  completes it arrives: no version number appears without an editor. */
export function versionSteps<Row extends { version_no: number }>(
  latest: number,
  first: number,
  rows: Row[],
  hasMore = false,
): VersionStep<Row>[] {
  const byNumber = new Map(rows.map((row) => [row.version_no, row]));
  const oldest = hasMore && rows.length > 0 ? Math.min(...byNumber.keys()) + 1 : first;
  const steps: VersionStep<Row>[] = [];
  for (let number = latest; number >= oldest; number--) {
    const own = byNumber.get(number);
    if (number !== latest && own === undefined) break;
    steps.push({ number, own, below: byNumber.get(number - 1) });
  }
  return steps;
}

/** Version number of a `vN` segment, or `null` (other shapes, so the route 404s). */
export function parseVersionSegment(segment: string): number | null {
  if (!/^v(0|[1-9][0-9]*)$/.test(segment)) return null;
  return Number(segment.slice(1));
}

/** Same members in any order. */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((value, i) => value === y[i]);
}

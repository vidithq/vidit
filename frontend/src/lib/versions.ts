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

/** A filed version row, as both version reads answer it. */
interface FiledRow {
  version_no: number;
  edited_by: Author | null;
  created_at: string;
  note: string | null;
  redacted?: boolean;
}

/** How one kind of record reads its version rows. */
export interface VersionReader<View, Row> {
  first: number;
  /** The record at a filed row, or `null` when redacted. */
  viewOf: (row: Row) => View | null;
  /** Byline of a version no row produced: the record's opening or first publication. */
  origin: (number: number) => Pick<VersionEntry<View>, "editor" | "createdAt">;
  changedFields: (view: View, previous: View) => string[];
}

/** Rows one version is assembled from. `own` is its content (absent for the live row);
 *  `producedBy` is the row numbered one lower, since the API files a write's byline on the
 *  version it superseded; `previous` is that lower version's view, the diff base. */
export interface VersionEntryRows<View, Row> {
  own?: Row | null;
  producedBy?: Row | null;
  previous?: View | null;
}

/** One version, described by the write that produced it: content from row `n`, authorship
 *  from row `n - 1`, or from `reader.origin` when no row produced it. */
export function versionEntry<View extends { version_no: number }, Row extends FiledRow>(
  current: View,
  number: number,
  { own = null, producedBy = null, previous = null }: VersionEntryRows<View, Row>,
  reader: VersionReader<View, Row>,
): VersionEntry<View> {
  const isCurrent = number === current.version_no;
  const view = isCurrent ? current : own ? reader.viewOf(own) : null;
  const byline = producedBy
    ? { editor: producedBy.edited_by, createdAt: producedBy.created_at }
    : reader.origin(number);
  return {
    number,
    current: isCurrent,
    view,
    ...byline,
    note: producedBy?.note ?? null,
    redacted: own?.redacted ?? false,
    changed: view && previous ? reader.changedFields(view, previous) : null,
  };
}

/** Versions newest first, on the walk of `versionSteps`. */
export function versionEntries<View extends { version_no: number }, Row extends FiledRow>(
  current: View,
  rows: Row[],
  hasMore: boolean,
  reader: VersionReader<View, Row>,
): VersionEntry<View>[] {
  return versionSteps(current.version_no, reader.first, rows, hasMore).map(
    ({ number, own, below }) =>
      versionEntry(
        current,
        number,
        {
          own,
          producedBy: below,
          previous: number > reader.first && below ? reader.viewOf(below) : null,
        },
        reader,
      ),
  );
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

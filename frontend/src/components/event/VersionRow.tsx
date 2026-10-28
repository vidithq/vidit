import Link from "next/link";

import { formatDate } from "@/lib/format";
import type { VersionedRecord, VersionEntry } from "@/lib/versions";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Pill } from "@/components/ui/Pill";
import { TAPPABLE_HOVER } from "@/components/ui/styles";

/**
 * One version in a record's history (an event, a site): its name, what its write changed
 * (`summary`), and who made it when. The whole row is one click: a past version opens at its own
 * address, the current one opens the record's page. A redacted version keeps its number and
 * byline and loses its content: the row states the redaction where the changed fields would be
 * and still links to the version, which serves the same notice.
 */
export function VersionRow({
  record,
  version,
  summary,
}: {
  record: VersionedRecord;
  version: VersionEntry<unknown>;
  summary: string | null;
}) {
  const name = record.label(version.number);
  return (
    <div
      className={`group relative flex flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-2.5 sm:col-span-2 sm:grid sm:grid-cols-subgrid sm:items-center sm:gap-x-3 ${TAPPABLE_HOVER}`}
    >
      {/* Stretched link: nothing inside the row competes for the click, so badges and byline sit under it. */}
      <Link
        href={record.href(version.number)}
        aria-label={name === `v${version.number}` ? `Version ${version.number}` : name}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <span className="flex shrink-0">
        <Pill tone="neutral">{name}</Pill>
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        {(summary || version.current || version.redacted) && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-100">
            {summary && <span className="group-hover:text-orange-400">{summary}</span>}
            {/* The number is a neutral label; the accent is for the state after the title. */}
            {version.current && <Pill tone="accent">Current</Pill>}
            {version.redacted && <Pill tone="danger">Redacted</Pill>}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-neutral-500">
          {version.editor && (
            // Unlinked: an anchor under the stretched link is reached by z-order for the mouse but as a
            // separate stop for the keyboard, so the two would diverge. The profile is one tap from the
            // version this row opens.
            <AuthorByline author={version.editor} prefix={false} link={false} />
          )}
          {/* Dropped, like the byline, when the row carrying the edit's date can't be read: the line states
              what is known, not another version's date. */}
          {version.createdAt && <span>{formatDate(version.createdAt)}</span>}
        </div>
        {/* The editor's words, kept out of the metadata line so a long note wraps on its own. */}
        {version.note && (
          <p className="text-xs text-neutral-400 [overflow-wrap:anywhere]">{version.note}</p>
        )}
      </div>
    </div>
  );
}

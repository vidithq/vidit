import Link from "next/link";

import { formatDate } from "@/lib/format";
import type { VersionedRecord, VersionEntry } from "@/lib/versions";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";

/**
 * What a record's `/vN` page says first (an event, a site): this is not the record as it
 * stands. Amber, the caution register: the reader isn't blocked, the way to the current version
 * is in the same sentence, and the link stays the app's one accent inside the amber card (the
 * `design.md` callout split).
 *
 * `lead` names the version (*Version 2 of 4* by default) and `verb` the write that produced it,
 * credited to its editor and dated. A gone editor account leaves the clause out, and so does an
 * unreadable producing row for the date.
 */
export function VersionBanner({
  record,
  version,
  verb,
  lead = `Version ${version.number} of ${record.latest}`,
}: {
  record: VersionedRecord;
  version: VersionEntry<unknown>;
  verb: string;
  lead?: string;
}) {
  return (
    <div className={`rounded-md px-4 py-3 text-sm ${WARNING_CALLOUT}`}>
      {lead}
      {version.editor && (
        <>
          , {verb} by <AuthorByline author={version.editor} prefix={false} />
        </>
      )}
      {version.createdAt && <> on {formatDate(version.createdAt)}</>}.{" "}
      <Link href={record.href(record.latest)} className={TEXT_LINK}>
        View the current version
      </Link>
      .
    </div>
  );
}

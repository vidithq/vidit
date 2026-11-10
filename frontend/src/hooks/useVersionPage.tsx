"use client";

import { useCallback, useEffect, type ReactElement } from "react";
import { notFound, useParams, useRouter } from "next/navigation";

import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import { skipBackRecord } from "@/lib/navigation";
import { parseVersionSegment, type VersionedRecord } from "@/lib/versions";
import { PageError, PageLoading } from "@/components/ui/PageShell";

interface Versioned {
  version_no: number;
}

function useParam(name: string): string {
  const value = useParams()[name];
  return typeof value === "string" ? value : "";
}

/** A version page's reads, or the page that stands in for it while they load or fail. */
type FiledVersion<Record, Row> =
  | { gate: ReactElement }
  | {
      gate: null;
      record: Record;
      versioned: VersionedRecord;
      number: number;
      row: Row;
      producedBy: Row | null;
    };

/**
 * One filed version at `/{kind}/{id}/vN`. Three reads: the record, the version, and the version
 * below (it holds the write's byline and date). The live version forwards to the record's page.
 */
export function useFiledVersion<Record extends Versioned, Row>({
  recordPath,
  versionPath,
  versioned,
  href,
}: {
  recordPath: (id: string) => string;
  versionPath: (id: string, number: number) => string;
  versioned: (record: Record) => VersionedRecord;
  href: (id: string) => string;
}): FiledVersion<Record, Row> {
  const router = useRouter();
  const id = useParam("id");
  const number = parseVersionSegment(useParam("version"));

  const { data: record, error } = useApiResource<Record>(
    id && number !== null ? recordPath(id) : null,
  );
  const addressed = record !== null ? versioned(record) : null;
  // Only versions below the live row are filed, from the first one the history holds.
  const first = addressed?.first ?? 1;
  const filed =
    record !== null && number !== null && number >= first && number < record.version_no;
  const { data: row, error: rowError } = useApiResource<Row>(
    filed ? versionPath(id, number!) : null,
  );
  const { data: producedBy, error: producedByError } = useApiResource<Row>(
    filed && number! > first ? versionPath(id, number! - 1) : null,
  );

  const isCurrent = record !== null && number === record.version_no;
  useEffect(() => {
    if (!isCurrent) return;
    // The current version has one address: forward to it, declaring this page out of the back-stack first.
    skipBackRecord();
    router.replace(href(id));
  }, [isCurrent, router, href, id]);

  if (number === null) notFound();
  if (error) return { gate: <PageError error={error} /> };
  if (!record || !addressed) return { gate: <PageLoading /> };
  if (number > record.version_no || number < first) notFound();
  if (isCurrent) return { gate: <PageLoading /> };
  if (rowError) return { gate: <PageError error={rowError} /> };
  if (!row) return { gate: <PageLoading /> };
  // The byline read lands last; if it fails the banner loses its byline, not the page its content.
  if (number > first && !producedBy && !producedByError) return { gate: <PageLoading /> };

  return { gate: null, record, versioned: addressed, number, row, producedBy };
}

/** The history read answers an envelope; module-level because `useCursorList` keys fetches on this function's identity. */
const pageItems = <Row,>(page: { items: Row[] }): Row[] => page.items;

/** The record and its version walk for `/{kind}/{id}/history`, or the page that stands in for
 *  the record while it loads or fails. */
export function useVersionHistory<Record, Row>({
  recordPath,
  versionsPath,
}: {
  recordPath: (id: string) => string;
  versionsPath: (id: string, cursor: string | null) => string;
}) {
  const id = useParam("id");
  const { data: record, error, refetch } = useApiResource<Record>(id ? recordPath(id) : null);

  const buildPath = useCallback((cursor: string | null) => versionsPath(id, cursor), [versionsPath, id]);
  const walk = useCursorList<Row, { items: Row[] }>(buildPath, pageItems);

  if (error) return { gate: <PageError error={error} onRetry={refetch} />, record: null, walk };
  if (!record) return { gate: <PageLoading />, record: null, walk };
  return { gate: null, record, walk };
}

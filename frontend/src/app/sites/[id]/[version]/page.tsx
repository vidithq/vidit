"use client";

import { useEffect } from "react";
import { notFound, useParams, useRouter } from "next/navigation";

import { useApiResource } from "@/hooks/useApiResource";
import { skipBackRecord } from "@/lib/navigation";
import {
  siteHref,
  sitePath,
  siteVersion,
  siteVersioned,
  siteVersionPath,
  type Site,
  type SiteVersion,
} from "@/lib/sites";
import { parseVersionSegment } from "@/lib/versions";
import { VersionBanner } from "@/components/event/VersionBanner";
import { VersionSelector } from "@/components/event/VersionSelector";
import { SiteBody } from "@/components/sites/SiteBody";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";

/**
 * One filed version of a site at `/sites/{id}/vN`, on the event version page's pattern: the site
 * page's body fed the version, read-only, under its banner, with the version selector as its one
 * pinned action. Links have no history, so the version shows no linked events. Three reads: the
 * site, the version, and the version below (it holds the write's byline and date).
 */
export default function SiteVersionPage() {
  const params = useParams();
  const router = useRouter();
  const siteId = typeof params.id === "string" ? params.id : "";
  const number = parseVersionSegment(typeof params.version === "string" ? params.version : "");

  const { data: site, error } = useApiResource<Site>(
    siteId && number !== null ? sitePath(siteId) : null,
  );
  const filed = site !== null && number !== null && number >= 1 && number < site.version_no;
  const { data: row, error: rowError } = useApiResource<SiteVersion>(
    filed ? siteVersionPath(siteId, number!) : null,
  );
  const { data: producedBy, error: producedByError } = useApiResource<SiteVersion>(
    filed && number! > 1 ? siteVersionPath(siteId, number! - 1) : null,
  );

  const isCurrent = site !== null && number === site.version_no;
  useEffect(() => {
    if (!isCurrent) return;
    // The current version has one address: forward to it, declaring this page out of the back-stack first.
    skipBackRecord();
    router.replace(siteHref(siteId));
  }, [isCurrent, router, siteId]);

  if (number === null) notFound();
  if (error) return <PageError message={error} />;
  if (!site) return <PageLoading />;
  if (number > site.version_no || number < 1) notFound();
  if (isCurrent) return <PageLoading />;
  if (rowError) return <PageError message={rowError} />;
  if (!row) return <PageLoading />;
  // The byline read lands last; if it fails the banner loses its byline, not the page its content.
  if (number > 1 && !producedBy && !producedByError) return <PageLoading />;

  const version = siteVersion(site, number, { own: row, producedBy: producedBy ?? undefined });
  const record = siteVersioned(site);

  return (
    <PageShell
      back
      backFallback={siteHref(site.id)}
      title={row.name}
      stickyActions={<VersionSelector record={record} selected={number} />}
      headerSide={null}
    >
      <VersionBanner record={record} version={version} verb={number === 1 ? "created" : "edited"} />
      {version.view && <SiteBody site={version.view} />}
    </PageShell>
  );
}

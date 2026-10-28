"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";

import { useApiResource } from "@/hooks/useApiResource";
import { useCursorList } from "@/hooks/useCursorList";
import { VersionHistory } from "@/components/event/VersionHistory";
import { VersionRow } from "@/components/event/VersionRow";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import {
  sitePath,
  siteVersioned,
  siteVersions,
  siteVersionsPath,
  type Site,
  type SiteVersion,
  type SiteVersionEntry,
  type SiteVersionList,
} from "@/lib/sites";

/** The history read answers an envelope; module-level because `useCursorList` keys fetches on this function's identity. */
const versionRows = (page: SiteVersionList): SiteVersion[] => page.items;

/** What a version's write did to the site: version 1 is the creation. */
function changeSummary(version: SiteVersionEntry): string | null {
  if (version.number === 1) return "Created";
  if (version.changed === null) return null;
  return version.changed.length === 0 ? "No versioned field changed" : version.changed.join(", ");
}

/**
 * Every version of one site, newest first, on the event history's page: each row names what its
 * write changed (the name, the kind, the sources, the contour) and who made it when. Public, so
 * any reader can follow the site's evolution. `siteVersions` holds back the oldest row of an
 * unfinished walk until *Load more* brings the page that completes it.
 */
export default function SiteHistoryPage() {
  const params = useParams();
  const siteId = typeof params.id === "string" ? params.id : "";
  const { data: site, error, refetch } = useApiResource<Site>(siteId ? sitePath(siteId) : null);

  const buildPath = useCallback((cursor: string | null) => siteVersionsPath(siteId, cursor), [siteId]);
  const walk = useCursorList<SiteVersion, SiteVersionList>(buildPath, versionRows);

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (!site) return <PageLoading />;

  const record = siteVersioned(site);

  return (
    // Plain-text title: the *Current* row already links to the site.
    <PageShell back title="Version history" subtitle={site.name}>
      <VersionHistory walk={walk} count={site.version_no}>
        {siteVersions(site, walk.items, walk.hasMore).map((version) => (
          <VersionRow
            key={version.number}
            record={record}
            version={version}
            summary={changeSummary(version)}
          />
        ))}
      </VersionHistory>
    </PageShell>
  );
}

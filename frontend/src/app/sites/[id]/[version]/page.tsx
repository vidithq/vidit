"use client";

import { useFiledVersion } from "@/hooks/useVersionPage";
import {
  siteHref,
  sitePath,
  siteVersion,
  siteVersioned,
  siteVersionPath,
  type Site,
  type SiteVersion,
} from "@/lib/sites";
import { VersionBanner } from "@/components/event/VersionBanner";
import { VersionSelector } from "@/components/event/VersionSelector";
import { SiteBody } from "@/components/sites/SiteBody";
import { PageShell } from "@/components/ui/PageShell";

/**
 * One filed version of a site at `/sites/{id}/vN`, on the event version page's pattern: the site
 * page's body fed the version, read-only, under its banner, with the version selector as its one
 * pinned action. Links have no history, so the version shows no linked events.
 */
export default function SiteVersionPage() {
  const filed = useFiledVersion<Site, SiteVersion>({
    recordPath: sitePath,
    versionPath: siteVersionPath,
    versioned: siteVersioned,
    href: siteHref,
  });
  if (filed.gate) return filed.gate;
  const { record: site, versioned, number, row, producedBy } = filed;

  const version = siteVersion(site, number, { own: row, producedBy });

  return (
    <PageShell
      back
      backFallback={siteHref(site.id)}
      title={row.name}
      stickyActions={<VersionSelector record={versioned} selected={number} />}
      headerSide={null}
    >
      <VersionBanner record={versioned} version={version} verb={number === 1 ? "created" : "edited"} />
      {version.view && <SiteBody site={version.view} />}
    </PageShell>
  );
}

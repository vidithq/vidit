"use client";

import { useParams } from "next/navigation";

import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { SiteBody } from "@/components/sites/SiteBody";
import { LinkedEvents } from "@/components/sites/SiteEventLists";
import { useSiteActions } from "@/components/sites/useSiteActions";
import { useApiResource } from "@/hooks/useApiResource";
import { sitePath, type Site } from "@/lib/sites";

/**
 * A site's page, on the event page's frame: the title section and the pinned actions on
 * `PageShell` (the version selector first, as on the event page), then `SiteBody`, its Sources
 * section followed by the Linked events section, newest first by date on the ground.
 */
export default function SitePage() {
  const params = useParams();
  const siteId = typeof params.id === "string" ? params.id : "";
  const { data: site, error, refetch } = useApiResource<Site>(siteId ? sitePath(siteId) : null);
  const actions = useSiteActions({ site, onChanged: refetch });

  if (error) return <PageError message={error} backHref="/map" />;
  if (!site) return <PageLoading />;

  return (
    <PageShell
      back
      backFallback="/map"
      title={site.name}
      stickyActions={actions.pinned}
      headerSide={null}
    >
      {actions.panels}
      <SiteBody
        site={site}
        imageControls={actions.imageControls}
        linked={<LinkedEvents events={site.linked_events} controls={actions.linkControls} />}
      />
    </PageShell>
  );
}

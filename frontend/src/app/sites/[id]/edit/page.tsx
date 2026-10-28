"use client";

import { useParams, useSearchParams } from "next/navigation";

import { SiteEditForm } from "@/components/sites/SiteEditForm";
import { PageError, PageLoading } from "@/components/ui/PageShell";
import { useApiResource } from "@/hooks/useApiResource";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { ownsSite, siteHref, sitePath, type Site } from "@/lib/sites";

/**
 * The owner's edit of one site, `SiteEditForm`, like the event edit page. Anyone else reads why
 * and goes back to the site, where any analyst files a source. `?source=` opens the Location block
 * on that source (from the receipt of a filed source).
 */
export default function EditSitePage() {
  const params = useParams();
  const search = useSearchParams();
  const { user, loading } = useRequireAuth();
  const siteId = typeof params.id === "string" ? params.id : "";
  const { data: site, error, refetch } = useApiResource<Site>(user && siteId ? sitePath(siteId) : null);

  if (loading || !user) return <PageLoading />;
  if (error) return <PageError error={error} onRetry={refetch} backHref="/map" />;
  if (!site) return <PageLoading />;
  if (!ownsSite(site, user.id)) {
    return (
      <PageError
        error="Only the site's owner edits it. File a source instead."
        backHref={siteHref(site.id)}
        backLabel="Back to the site"
      />
    );
  }
  return <SiteEditForm site={site} owner={user} initialSource={search.get("source")} />;
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { PageColumns, PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK } from "@/components/ui/styles";
import { SiteSourceEditor, SiteWriteActions, useSiteSourceDraft } from "@/components/sites/SiteSourceEditor";
import { SiteLocation } from "@/components/sites/SiteLocation";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { fileSiteSource, latestSource, siteHref, sitePath, type Site } from "@/lib/sites";
import { sourceName, sourceWriteError } from "@/lib/sources";

/**
 * Files a dated satellite source on a site, open to any signed-in analyst. The main column holds
 * the source editor, the side column the site's current zone to match it against. Filing saves a
 * new version of the site, and returns to the site page, which lists the new source.
 */
export default function FileSiteSourcePage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading } = useRequireAuth();
  const siteId = typeof params.id === "string" ? params.id : "";
  const { data: site, error, refetch } = useApiResource<Site>(siteId ? sitePath(siteId) : null);
  const draft = useSiteSourceDraft();
  const [attempt, setAttempt] = useState(0);
  const write = useMutation(() => fileSiteSource(siteId, draft.payload()), {
    fallback: "The source was not filed. Try again.",
    onError: sourceWriteError,
    onSuccess: () => router.push(siteHref(siteId)),
  });

  if (error) return <PageError error={error} onRetry={refetch} backHref="/map" />;
  if (loading || !user || !site) return <PageLoading />;

  const submit = () => {
    setAttempt((n) => n + 1);
    if (draft.missing.length > 0) return;
    if (draft.held) {
      write.setError(draft.held);
      return;
    }
    void write.run();
  };

  const subtitle = (
    <span className="text-sm text-neutral-400">
      On{" "}
      <Link href={siteHref(site.id)} className={TEXT_LINK}>
        {site.name}
      </Link>
    </span>
  );

  return (
    <PageShell
      back
      backFallback={siteHref(site.id)}
      title="File a source"
      subtitle={subtitle}
      headerSide={null}
      stickyActions={
        <SiteWriteActions
          label="File the source"
          busyLabel="Filing…"
          action="fileSource"
          missing={draft.missing}
          attempt={attempt}
          busy={write.loading}
          error={write.error}
          onWrite={submit}
        />
      }
    >
      <PageColumns
        main={
          <section>
            <SectionEyebrow title="Satellite source" concept="site_source" besideScroller />
            <SiteSourceEditor state={draft} flagged={attempt > 0} name={sourceName(site.sources.length)} />
          </section>
        }
        side={
          <section>
            <SectionEyebrow title="Current zone" concept="site_zone" besideScroller />
            <SiteLocation site={site} source={latestSource(site.sources)} />
          </section>
        }
      />
    </PageShell>
  );
}

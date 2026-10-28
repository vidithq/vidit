"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Card } from "@/components/ui/Card";
import { ActionIcon, buttonClasses } from "@/components/ui/Button";
import { PageColumns, PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_SUCCESS_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";
import { siteSourceMention, siteSourceName } from "@/components/sites/SiteSourceBlock";
import { SiteSourceEditor, SiteWriteActions, useSiteSourceDraft } from "@/components/sites/SiteSourceEditor";
import { SiteLocation } from "@/components/sites/SiteLocation";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { cn } from "@/lib/cn";
import {
  fileSiteSource,
  latestSource,
  ownsSite,
  siteEditHref,
  siteHref,
  sitePath,
  type Site,
  type SiteSourceFiled,
} from "@/lib/sites";
import { sourceName, sourceWriteError } from "@/lib/sources";

/**
 * Files a dated satellite source on a site, open to any signed-in analyst. The main column holds
 * the source editor, the side column the site's current zone to match it against. Filing saves a
 * new version of the site. A filed source lands on a receipt: it says when the site already holds
 * a source of the same provider and day, and offers the owner the edit page to draw a contour on
 * it.
 */
export default function FileSiteSourcePage() {
  const params = useParams();
  const { user, loading } = useRequireAuth();
  const siteId = typeof params.id === "string" ? params.id : "";
  const { data: site, error, refetch } = useApiResource<Site>(siteId ? sitePath(siteId) : null);
  const draft = useSiteSourceDraft();
  const [attempt, setAttempt] = useState(0);
  const [filed, setFiled] = useState<SiteSourceFiled | null>(null);
  const write = useMutation(() => fileSiteSource(siteId, draft.payload()), {
    fallback: "The source was not filed. Try again.",
    onError: sourceWriteError,
    onSuccess: setFiled,
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

  if (filed) {
    const duplicates = site.sources.filter((s) => filed.duplicate_source_ids.includes(s.id));
    return (
      <PageShell back backFallback={siteHref(site.id)} title="Source filed" subtitle={subtitle}>
        <Card dense className="max-w-xl">
          <p className={FORM_SUCCESS_BANNER} role="status">
            {siteSourceName(filed)} is on the site.
          </p>
          {duplicates.length > 0 && (
            <p className={cn("rounded-md px-3 py-2 text-sm", WARNING_CALLOUT)}>
              The site already holds a source from the same provider on the same day:{" "}
              {duplicates.map(siteSourceMention).join(", ")}. Check that the two are not the same
              capture.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={siteHref(site.id)} className={buttonClasses("primary")}>
              <ActionIcon action="site" />
              Open the site page
            </Link>
            {ownsSite(site, user.id) && (
              <Link href={siteEditHref(site.id, filed.id)} className={buttonClasses("secondary")}>
                <ActionIcon action="draw" />
                Draw a contour on this source
              </Link>
            )}
          </div>
        </Card>
      </PageShell>
    );
  }

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

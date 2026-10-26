"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ImagePlus } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { PageColumns, PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_SUCCESS_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";
import { imageName } from "@/components/sites/SiteImageBlock";
import { SiteImageEditor, SiteWriteActions, useSiteImageDraft } from "@/components/sites/SiteImageEditor";
import { SiteLocation } from "@/components/sites/SiteLocation";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { cn } from "@/lib/cn";
import {
  fileSiteImage,
  latestImage,
  ownsSite,
  siteContourHref,
  siteHref,
  sitePath,
  type Site,
  type SiteImageFiled,
} from "@/lib/sites";
import { sourceWriteError } from "@/lib/sources";

/**
 * Files a dated satellite image in a site's imagery history, open to any signed-in analyst. The
 * main column holds the image editor, the side column the site's current zone to match it
 * against. A filed image lands on a receipt: it says when the site already holds an image of the
 * same provider and day, and offers the owner to draw the contour from it.
 */
export default function FileSiteImagePage() {
  const params = useParams();
  const { user, loading } = useRequireAuth();
  const siteId = typeof params.id === "string" ? params.id : "";
  const { data: site, error } = useApiResource<Site>(siteId ? sitePath(siteId) : null);
  const image = useSiteImageDraft();
  const [attempt, setAttempt] = useState(0);
  const [filed, setFiled] = useState<SiteImageFiled | null>(null);
  const write = useMutation(() => fileSiteImage(siteId, image.payload()), {
    fallback: "The image was not filed. Try again.",
    onError: sourceWriteError,
    onSuccess: setFiled,
  });

  if (error) return <PageError message={error} backHref="/map" />;
  if (loading || !user || !site) return <PageLoading />;

  const submit = () => {
    setAttempt((n) => n + 1);
    if (image.missing.length > 0) return;
    if (image.held) {
      write.setError(image.held);
      return;
    }
    void write.run();
  };

  const subtitle = (
    <span className="text-sm text-neutral-400">
      In the imagery history of{" "}
      <Link href={siteHref(site.id)} className={TEXT_LINK}>
        {site.name}
      </Link>
    </span>
  );

  if (filed) {
    const duplicates = site.images.filter((i) => filed.duplicate_image_ids.includes(i.id));
    return (
      <PageShell back backFallback={siteHref(site.id)} title="Image filed" subtitle={subtitle}>
        <Card dense className="max-w-xl">
          <p className={FORM_SUCCESS_BANNER} role="status">
            {imageName(filed)} is in the imagery history.
          </p>
          {duplicates.length > 0 && (
            <p className={cn("rounded-md px-3 py-2 text-sm", WARNING_CALLOUT)}>
              The site already holds an image from the same provider on the same day:{" "}
              {duplicates.map((d) => `the ${imageName(d).replace("Image", "image")}`).join(", ")}. Check that the two
              are not the same image.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={siteHref(site.id)} className={buttonClasses("primary")}>
              Open the site page
            </Link>
            {ownsSite(site, user.id) && (
              <Link href={siteContourHref(site.id, filed.id)} className={buttonClasses("secondary")}>
                Draw the contour from this image
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
      title="File an image"
      subtitle={subtitle}
      headerSide={null}
      stickyActions={
        <SiteWriteActions
          label="File the image"
          busyLabel="Filing…"
          icon={<ImagePlus size={14} />}
          missing={image.missing}
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
            <SectionEyebrow title="Satellite image" concept="site_image" besideScroller />
            <SiteImageEditor state={image} flagged={attempt > 0} />
          </section>
        }
        side={
          <section>
            <SectionEyebrow title="Current zone" concept="site_zone" besideScroller />
            <SiteLocation site={site} image={latestImage(site.images)} />
          </section>
        }
      />
    </PageShell>
  );
}

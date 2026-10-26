"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PenTool } from "lucide-react";

import { SourceBlock } from "@/components/sources/SourceBlock";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { Select } from "@/components/ui/Input";
import { PageColumns, PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";
import { imageChoiceLabels, imageName } from "@/components/sites/SiteImageBlock";
import { SiteWriteActions } from "@/components/sites/SiteImageEditor";
import { ZoneEditor, useDrawHistory } from "@/components/sites/ZoneEditor";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { cn } from "@/lib/cn";
import { formatInstantDate } from "@/lib/format";
import { padBounds } from "@/lib/viewport";
import {
  drawFromZone,
  drawReady,
  positionsBounds,
  zoneFromVertices,
  zoneVertices,
} from "@/lib/siteZone";
import {
  contourOn,
  drawSiteContour,
  ownsSite,
  siteHref,
  sitePath,
  sortImages,
  todayUtc,
  utcDay,
  type Site,
} from "@/lib/sites";

/**
 * The owner's contour editor: the current contour, editable in place on the map (drag a corner,
 * drag out a new one, remove one, or start over), and the filed image that shows the new
 * outline. The contour holds from that image's capture date. `?image=` picks the image the page
 * opens on (from the receipt of a filed image).
 */
export default function SiteContourPage() {
  const params = useParams();
  const { loading } = useRequireAuth();
  const { user } = useAuth();
  const siteId = typeof params.id === "string" ? params.id : "";
  const { data: site, error } = useApiResource<Site>(siteId ? sitePath(siteId) : null);

  if (error) return <PageError message={error} backHref="/map" />;
  if (loading || !user || !site) return <PageLoading />;
  if (!ownsSite(site, user.id)) {
    return (
      <PageError
        message="Only the site's owner draws its contour. File an image instead."
        backHref={siteHref(site.id)}
        backLabel="Back to the site"
      />
    );
  }
  return <ContourForm site={site} />;
}

function ContourForm({ site }: { site: Site }) {
  const router = useRouter();
  const search = useSearchParams();
  const images = sortImages(site.images, "fact");
  const asked = search.get("image");
  const [imageId, setImageId] = useState(
    images.some((i) => i.id === asked) ? asked! : (images[0]?.id ?? ""),
  );
  const history = useDrawHistory(drawFromZone(site.zone));
  const [attempt, setAttempt] = useState(0);
  const write = useMutation(
    () => drawSiteContour(site.id, zoneFromVertices(history.state.vertices), imageId),
    { fallback: "The contour was not saved. Try again.", onSuccess: () => router.push(siteHref(site.id)) },
  );

  const choices = imageChoiceLabels(images);
  const image = site.images.find((i) => i.id === imageId) ?? null;
  const current = contourOn(site.contours, todayUtc());
  const unchanged =
    JSON.stringify(history.state.vertices) === JSON.stringify(zoneVertices(site.zone));
  const missing = [
    ...(drawReady(history.state) ? [] : ["A closed contour whose edges do not cross"]),
    ...(unchanged ? ["A change to the contour"] : []),
    ...(image ? [] : ["The image that shows it"]),
  ];
  const olderThanCurrent =
    image?.captured_at && current && utcDay(image.captured_at) < utcDay(current.captured_at);

  const submit = () => {
    setAttempt((n) => n + 1);
    if (missing.length === 0) void write.run();
  };

  return (
    <PageShell
      back
      backFallback={siteHref(site.id)}
      title="Redraw the contour"
      subtitle={
        <Link href={siteHref(site.id)} className={`text-sm ${TEXT_LINK}`}>
          {site.name}
        </Link>
      }
      headerSide={null}
      stickyActions={
        <SiteWriteActions
          label="Save the contour"
          busyLabel="Saving…"
          icon={<PenTool size={14} />}
          missing={missing}
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
            <SectionEyebrow title="Contour" concept="site_zone" besideScroller />
            <ZoneEditor
              label="Contour"
              history={history}
              sites={[]}
              reference={site.zone}
              onReset={() => history.change(drawFromZone(site.zone))}
              bounds={padBounds(positionsBounds(zoneVertices(site.zone))!)}
              invalid={attempt > 0 && !drawReady(history.state)}
            />
          </section>
        }
        side={
          <section className="space-y-3">
            <SectionEyebrow title="Image that shows it" concept="site_contour_image" besideScroller margin="none" />
            <div className="space-y-1.5">
              <FieldLabel label="Image" htmlFor="contour-image" invalid={attempt > 0 && !image} />
              <Select
                id="contour-image"
                value={imageId}
                invalid={attempt > 0 && !image}
                onChange={(e) => setImageId(e.target.value)}
              >
                {images.map((i) => (
                  <option key={i.id} value={i.id}>
                    {choices.get(i.id)}
                  </option>
                ))}
              </Select>
            </div>
            {olderThanCurrent && current && (
              <p className={cn("rounded-md px-3 py-2 text-xs", WARNING_CALLOUT)}>
                This image predates the current contour, from {formatInstantDate(current.captured_at)}.
                The new contour holds from {formatInstantDate(image.captured_at!)} until then, and
                the current zone stays as it is.
              </p>
            )}
            {image && (
              <SourceBlock source={image} index={0} alt={site.name} compact name={imageName(image)} />
            )}
          </section>
        }
      />
    </PageShell>
  );
}

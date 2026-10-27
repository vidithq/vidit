"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, RotateCcw, Save } from "lucide-react";

import { EventSection } from "@/components/event/EventLayout";
import { EventShell } from "@/components/event/EventShell";
import { SourceBlock } from "@/components/sources/SourceBlock";
import { SourcesRow } from "@/components/sources/SourcesRow";
import { Button } from "@/components/ui/Button";
import type { HorizontalScrollerHandle } from "@/components/ui/HorizontalScroller";
import { PageColumns } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";
import { RemoveButton } from "@/components/ui/RemoveButton";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import { useMutation } from "@/hooks/useMutation";
import { cn } from "@/lib/cn";
import type { components } from "@/lib/api-types";
import { formatInstantDate } from "@/lib/format";
import { positionsBounds, zoneVertices } from "@/lib/siteZone";
import {
  contourFromImage,
  saveSiteVersion,
  siteHref,
  sortImages,
  utcDay,
  type Site,
  type SiteImage,
  type SiteKind,
  type SiteVersionCreate,
  type Zone,
} from "@/lib/sites";
import { sourceWriteError } from "@/lib/sources";
import { padBounds } from "@/lib/viewport";
import { ContourDraft, SiteKindCard, SiteNameField, type ContourDraftValue } from "./SiteFormFields";
import { ShowOnMap, imageName, removeImageLabel, siteImageExtras } from "./SiteImageBlock";
import { SiteImageEditor, SiteWriteActions, useSiteImageDraft } from "./SiteImageEditor";
import { SiteLinksField, linkPayload, type DraftLink } from "./SiteLinksField";

type Author = components["schemas"]["AuthorRef"];

/** The contour key of the image the form adds, beside the live images' ids. */
const ADDED = "added";
const ADDED_NAME = "New image";

function sameLinks(a: DraftLink[], b: DraftLink[]): boolean {
  const key = (links: DraftLink[]) =>
    JSON.stringify(links.map((l) => `${l.id} ${l.effect}`).sort());
  return key(a) === key(b);
}

/**
 * The owner's edit of a site, laid out like the site page: the name typed in the page title, the
 * Sources section (each image with its filer's Remove, and **Add an image**), then the owner's
 * Linked events, in the main column; the Location block, where the owner draws the contour of one
 * image, then the Details block with the kind, in the side column. One **Save** writes
 * everything through `POST /sites/{id}/versions`, which files one version.
 *
 * An image is removed once it carries no contour: the owner first redraws that contour on another
 * image, or clears it with **Start over**. The site keeps at least one image with a contour.
 */
export function SiteEditForm({
  site,
  owner,
  initialImage,
}: {
  site: Site;
  owner: Author;
  /** The image the Location block opens on (`?image=`). */
  initialImage: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(site.name);
  const [kind, setKind] = useState<SiteKind | "">(site.kind);
  const [adding, setAdding] = useState(false);
  // The new image leads the row, so adding one scrolls the row back to it.
  const scroller = useRef<HorizontalScrollerHandle>(null);
  useEffect(() => {
    if (adding) scroller.current?.show(0);
  }, [adding]);
  const image = useSiteImageDraft();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, ContourDraftValue>>({});
  const [ownLinks] = useState<DraftLink[]>(() =>
    site.linked_events
      .filter((e) => e.owner.id === owner.id)
      .map(({ id, title, occurred_date, media, is_graphic, effect }) => ({
        id,
        title,
        occurred_date,
        media,
        is_graphic,
        effect,
      })),
  );
  const [links, setLinks] = useState(ownLinks);
  const [attempt, setAttempt] = useState(0);

  const images = sortImages(site.images);
  const kept = images.filter((i) => !removed.has(i.id));
  const keys = [...kept.map((i) => i.id), ...(adding ? [ADDED] : [])];
  const current = site.contours.find((c) => c.id === site.contour_id);
  const [picked, setPicked] = useState(
    initialImage && images.some((i) => i.id === initialImage)
      ? initialImage
      : (current?.image_id ?? images[0]?.id ?? ""),
  );
  const pickedKey = keys.includes(picked) ? picked : (keys[0] ?? "");

  const liveZone = (key: string): Zone | null =>
    key === ADDED ? null : (contourFromImage(site.contours, key)?.zone ?? null);
  const zoneOf = (key: string): Zone | null | "open" => {
    const draft = drafts[key];
    return draft === undefined ? liveZone(key) : draft;
  };
  const setDraft = (key: string, value: ContourDraftValue) =>
    setDrafts((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });

  const changes = Object.entries(drafts).filter(([key]) => key !== ADDED || adding);
  const contours: SiteVersionCreate["contours"] = changes.flatMap(([key, value]) =>
    value === undefined || value === "open"
      ? []
      : [key === ADDED ? { added_image: 0, zone: value } : { image_id: key, zone: value }],
  );
  const open = changes.some(([, value]) => value === "open");
  const anyContour = keys.some((key) => {
    const zone = zoneOf(key);
    return zone !== null && zone !== "open";
  });
  const linksChanged = !sameLinks(ownLinks, links);
  const changed =
    name.trim() !== site.name ||
    kind !== site.kind ||
    adding ||
    removed.size > 0 ||
    contours.length > 0 ||
    linksChanged;
  const missing = [
    ...(name.trim() ? [] : ["Name"]),
    ...(adding ? image.missing : []),
    ...(open ? ["A closed contour whose edges do not cross"] : []),
    ...(anyContour ? [] : ["An image with a contour"]),
    ...(changed ? [] : ["A change to the site"]),
  ];
  const flagged = attempt > 0;

  const save = useMutation(
    () =>
      saveSiteVersion(site.id, {
        version_no: site.version_no,
        name: name.trim(),
        kind: kind as SiteKind,
        added_images: adding ? [image.payload()] : [],
        removed_image_ids: [...removed],
        contours,
        event_links: linksChanged ? linkPayload(links) : null,
      }),
    {
      fallback: "The site was not saved. Try again.",
      onError: sourceWriteError,
      onSuccess: () => router.push(siteHref(site.id)),
    },
  );
  const submit = () => {
    setAttempt((n) => n + 1);
    if (missing.length > 0) return;
    if (adding && image.held) {
      save.setError(image.held);
      return;
    }
    void save.run();
  };

  const imageControls = (img: SiteImage) => {
    if (img.author?.id !== owner.id) return null;
    if (removed.has(img.id)) {
      return (
        <>
          <Pill tone="danger">Removed on save</Pill>
          <Button
            icon
            variant="ghost"
            aria-label={`Keep the ${imageName(img).replace("Image", "image")}`}
            onClick={() => setRemoved((prev) => new Set([...prev].filter((id) => id !== img.id)))}
          >
            <RotateCcw size={14} />
          </Button>
        </>
      );
    }
    const carries = zoneOf(img.id) !== null;
    return (
      <RemoveButton
        label={removeImageLabel(img, carries)}
        disabled={carries}
        onClick={() => setRemoved((prev) => new Set([...prev, img.id]))}
      />
    );
  };

  const pickedImage = kept.find((i) => i.id === pickedKey) ?? null;
  const pickedZone = zoneOf(pickedKey);
  const capturedAt = pickedKey === ADDED ? image.payload().captured_at : pickedImage?.captured_at;
  const olderThanCurrent =
    capturedAt && current && utcDay(capturedAt) < utcDay(current.captured_at);
  const bounds = positionsBounds(site.contours.flatMap((c) => zoneVertices(c.zone)));

  return (
    <EventShell
      title="Edit the site"
      titleField={<SiteNameField value={name} onChange={setName} invalid={flagged && !name.trim()} />}
      backFallback={siteHref(site.id)}
      actions={{
        pinned: (
          <SiteWriteActions
            label="Save"
            busyLabel="Saving…"
            icon={<Save size={14} />}
            missing={missing}
            attempt={attempt}
            busy={save.loading}
            error={save.error}
            onWrite={submit}
          />
        ),
      }}
      panels={
        <PageColumns
          main={
            <>
              <SourcesRow
                ref={scroller}
                count={kept.length + (adding ? 1 : 0)}
                invalid={flagged && adding && image.missing.length > 0}
                actions={
                  !adding && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setAdding(true);
                        setPicked(ADDED);
                      }}
                    >
                      <ImagePlus size={13} />
                      Add an image
                    </Button>
                  )
                }
              >
                {adding && (
                  <SiteImageEditor
                    state={image}
                    flagged={flagged}
                    name={ADDED_NAME}
                    actions={
                      <>
                        <ShowOnMap
                          name={ADDED_NAME}
                          shown={pickedKey === ADDED}
                          onShow={() => setPicked(ADDED)}
                        />
                        <RemoveButton
                          label="Discard the new image"
                          onClick={() => {
                            setAdding(false);
                            setDraft(ADDED, undefined);
                          }}
                        />
                      </>
                    }
                  />
                )}
                {images.map((img, index) => {
                  const zone = zoneOf(img.id);
                  return (
                    <SourceBlock
                      key={img.id}
                      source={img}
                      index={index}
                      alt={site.name}
                      wide={images.length === 1 && !adding}
                      {...siteImageExtras({
                        image: img,
                        contour: zone && zone !== "open" ? { zone } : null,
                        shown: img.id === pickedKey,
                        onShow: () => setPicked(img.id),
                        controls: imageControls(img),
                      })}
                      className={cn(
                        img.id === pickedKey && "border-orange-500/50",
                        removed.has(img.id) && "opacity-60",
                      )}
                    />
                  );
                })}
              </SourcesRow>
              <SiteLinksField links={links} onChange={setLinks} author={owner} />
            </>
          }
          side={
            <>
              <EventSection
                name="location"
                concept="site_location"
                besideScroller
                slot={{
                  invalid: flagged && (open || !anyContour),
                  content: (
                    <div className="space-y-3">
                      {pickedKey && (
                        <ContourDraft
                          key={pickedKey}
                          live={liveZone(pickedKey)}
                          start={pickedZone === "open" ? liveZone(pickedKey) : pickedZone}
                          reference={liveZone(pickedKey) ?? site.zone}
                          onChange={(value) => setDraft(pickedKey, value)}
                          bounds={bounds ? padBounds(bounds) : undefined}
                          invalid={flagged && (pickedZone === "open" || !anyContour)}
                        />
                      )}
                      {olderThanCurrent && current && (
                        <p className={cn("rounded-md px-3 py-2 text-xs", WARNING_CALLOUT)}>
                          This image predates the current contour, from{" "}
                          {formatInstantDate(current.captured_at)}. A contour drawn on it holds from{" "}
                          {formatInstantDate(capturedAt)} until then, and the current zone stays as it
                          is.
                        </p>
                      )}
                    </div>
                  ),
                }}
              />
              <EventSection
                name="details"
                concept="site_details"
                slot={{ content: <SiteKindCard value={kind} onChange={setKind} invalid={flagged && !kind} /> }}
              />
            </>
          }
        />
      }
    />
  );
}

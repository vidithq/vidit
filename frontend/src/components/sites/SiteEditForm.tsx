"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw, Save } from "lucide-react";

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
  contourOfSource,
  saveSiteVersion,
  siteHref,
  sortSources,
  utcDay,
  type Site,
  type SiteSource,
  type SiteKind,
  type SiteVersionCreate,
  type Zone,
} from "@/lib/sites";
import { sourceName, sourceWriteError } from "@/lib/sources";
import { padBounds } from "@/lib/viewport";
import { ContourDraft, SiteKindCard, SiteNameField, type ContourDraftValue } from "./SiteFormFields";
import { ShowOnMap, removeSourceLabel, siteSourceExtras, siteSourceMention } from "./SiteSourceBlock";
import { SiteSourceEditor, SiteWriteActions, useSiteSourceDraft } from "./SiteSourceEditor";

type Author = components["schemas"]["AuthorRef"];

/** The contour key of the source the form adds, beside the live sources' ids. */
const ADDED = "added";

/**
 * The owner's edit of a site, laid out like the site page: the name typed in the page title, the
 * Sources section (each source with its filer's Remove, and **Add a source**) in the main column;
 * the Location block, where the owner draws the contour of one
 * source, then the Details block with the kind, in the side column. One **Save** writes
 * everything through `POST /sites/{id}/versions`, which files one version.
 *
 * A source is removed once it carries no contour: the owner first redraws that contour on another
 * source, or clears it with **Start over**. The site keeps at least one source with a contour.
 */
export function SiteEditForm({
  site,
  owner,
  initialSource,
}: {
  site: Site;
  owner: Author;
  /** The source the Location block opens on (`?source=`). */
  initialSource: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(site.name);
  const [kind, setKind] = useState<SiteKind | "">(site.kind);
  const [adding, setAdding] = useState(false);
  // The new source leads the row, so adding one scrolls the row back to it.
  const scroller = useRef<HorizontalScrollerHandle>(null);
  useEffect(() => {
    if (adding) scroller.current?.show(0);
  }, [adding]);
  const newSource = useSiteSourceDraft();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, ContourDraftValue>>({});
  const [attempt, setAttempt] = useState(0);

  const sources = sortSources(site.sources);
  const addedName = sourceName(sources.length);
  const kept = sources.filter((i) => !removed.has(i.id));
  const keys = [...kept.map((i) => i.id), ...(adding ? [ADDED] : [])];
  const current = site.contours.find((c) => c.id === site.contour_id);
  const [picked, setPicked] = useState(
    initialSource && sources.some((i) => i.id === initialSource)
      ? initialSource
      : (current?.source_id ?? sources[0]?.id ?? ""),
  );
  const pickedKey = keys.includes(picked) ? picked : (keys[0] ?? "");

  const liveZone = (key: string): Zone | null =>
    key === ADDED ? null : (contourOfSource(site.contours, key)?.zone ?? null);
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
      : [key === ADDED ? { added_source: 0, zone: value } : { source_id: key, zone: value }],
  );
  const open = changes.some(([, value]) => value === "open");
  const anyContour = keys.some((key) => {
    const zone = zoneOf(key);
    return zone !== null && zone !== "open";
  });
  const changed =
    name.trim() !== site.name ||
    kind !== site.kind ||
    adding ||
    removed.size > 0 ||
    contours.length > 0;
  const missing = [
    ...(name.trim() ? [] : ["Name"]),
    ...(adding ? newSource.missing : []),
    ...(open ? ["A closed contour whose edges do not cross"] : []),
    ...(anyContour ? [] : ["A source with a contour"]),
    ...(changed ? [] : ["A change to the site"]),
  ];
  const flagged = attempt > 0;

  const save = useMutation(
    () =>
      saveSiteVersion(site.id, {
        version_no: site.version_no,
        name: name.trim(),
        kind: kind as SiteKind,
        added_sources: adding ? [newSource.payload()] : [],
        removed_source_ids: [...removed],
        contours,
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
    if (adding && newSource.held) {
      save.setError(newSource.held);
      return;
    }
    void save.run();
  };

  const sourceControls = (source: SiteSource) => {
    if (source.author?.id !== owner.id) return null;
    if (removed.has(source.id)) {
      return (
        <>
          <Pill tone="danger">Removed on save</Pill>
          <Button
            icon
            variant="ghost"
            aria-label={`Keep ${siteSourceMention(source)}`}
            onClick={() => setRemoved((prev) => new Set([...prev].filter((id) => id !== source.id)))}
          >
            <RotateCcw size={14} />
          </Button>
        </>
      );
    }
    const carries = zoneOf(source.id) !== null;
    return (
      <RemoveButton
        label={removeSourceLabel(source, carries)}
        disabled={carries}
        onClick={() => setRemoved((prev) => new Set([...prev, source.id]))}
      />
    );
  };

  const pickedSource = kept.find((i) => i.id === pickedKey) ?? null;
  const pickedZone = zoneOf(pickedKey);
  const capturedAt = pickedKey === ADDED ? newSource.payload().captured_at : pickedSource?.captured_at;
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
                invalid={flagged && adding && newSource.missing.length > 0}
                actions={
                  !adding && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setAdding(true);
                        setPicked(ADDED);
                      }}
                    >
                      <Plus size={13} strokeWidth={2} />
                      Add a source
                    </Button>
                  )
                }
              >
                {adding && (
                  <SiteSourceEditor
                    state={newSource}
                    flagged={flagged}
                    name={addedName}
                    actions={
                      <>
                        <ShowOnMap
                          name={addedName}
                          shown={pickedKey === ADDED}
                          onShow={() => setPicked(ADDED)}
                        />
                        <RemoveButton
                          label="Discard the new source"
                          onClick={() => {
                            setAdding(false);
                            setDraft(ADDED, undefined);
                          }}
                        />
                      </>
                    }
                  />
                )}
                {sources.map((source, index) => {
                  const zone = zoneOf(source.id);
                  return (
                    <SourceBlock
                      key={source.id}
                      source={source}
                      index={index}
                      alt={site.name}
                      wide={sources.length === 1 && !adding}
                      {...siteSourceExtras({
                        source,
                        contour: zone && zone !== "open" ? { zone } : null,
                        shown: source.id === pickedKey,
                        onShow: () => setPicked(source.id),
                        controls: sourceControls(source),
                      })}
                      className={cn(
                        source.id === pickedKey && "border-orange-500/50",
                        removed.has(source.id) && "opacity-60",
                      )}
                    />
                  );
                })}
              </SourcesRow>
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
                          This source predates the current contour, from{" "}
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

"use client";

import type { ComponentProps, ReactNode } from "react";

import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailCard, DetailPills, DetailRow } from "@/components/ui/DetailRow";
import { PageColumns, PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { CollectionIcon, collectionSpanLabel, eventCountLabel } from "@/lib/collections";
import { formatInstantDate } from "@/lib/format";

/**
 * The one shell of a collection: the collection page and both collection forms render it and only
 * fill its slots, the way `EventShell` serves an event (zones in `docs/design.md`, Collections).
 * The frame is wide, the actions are pinned top right, and the body is `PageColumns` with its side
 * column pinned while the main column scrolls.
 *
 * With `form`, the columns render inside a `<form>` laid out as `display: contents`. A control
 * outside it (the Title field, the submit) reaches the form through its `form` attribute.
 */
export function CollectionShell({
  title,
  titleField,
  owner,
  backFallback,
  actions,
  below,
  panels,
  main,
  side,
  form,
}: {
  /** The collection's title, or a form's page name, which `titleField` hides. */
  title: string;
  titleField?: ReactNode;
  owner: ComponentProps<typeof AuthorByline>["author"];
  /** Where Back lands when the session has nothing to return to (`smartBack`'s fallback). */
  backFallback?: string;
  /** The row pinned top right. */
  actions: ReactNode;
  /** Under the pinned row, not pinned: a form's hidden announcer. */
  below?: ReactNode;
  /** Full width between the header and the columns: the panels the actions open, banners. */
  panels?: ReactNode;
  main: ReactNode;
  side: ReactNode;
  form?: ComponentProps<"form">;
}) {
  const columns = <PageColumns stickySide main={main} side={side} />;
  return (
    <>
      {/* A form's page name leaves the screen, so the browser tab carries it. */}
      {titleField && <title>{`${title} on Vidit`}</title>}
      <PageShell
        back
        backFallback={backFallback}
        title={title}
        titleField={titleField}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <AuthorByline author={owner} avatar />
            {/* Says which kind of page this is (collection and event pages share a shape). */}
            <Pill tone="neutral" icon={<CollectionIcon size={11} />}>
              Collection
            </Pill>
          </span>
        }
        stickyActions={actions}
        headerSide={below ?? null}
      >
        {panels}
        {form ? (
          <form {...form} className="contents">
            {columns}
          </form>
        ) : (
          columns
        )}
      </PageShell>
    </>
  );
}

/**
 * The side column's Details section, the event and site pages' `DetailCard`: the count, the span
 * the item dates cover, the derived tags and the creation date. A form passes what it holds so
 * far, without the server-derived tags.
 */
export function CollectionDetails({
  count,
  first,
  last,
  tags = [],
  created,
}: {
  count: number;
  first: string | null;
  last: string | null;
  tags?: { id: string; name: string }[];
  created?: string;
}) {
  const span = collectionSpanLabel(first, last);
  return (
    <section>
      <SectionEyebrow title="Details" />
      <DetailCard>
        <DetailRow label="Events" value={eventCountLabel(count)} />
        {span && <DetailRow label="Span" value={span} />}
        {tags.length > 0 && (
          <DetailRow label="Tags" align="start">
            <DetailPills items={tags} />
          </DetailRow>
        )}
        {created && <DetailRow label="Created" value={formatInstantDate(created)} />}
      </DetailCard>
    </section>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { ArchivedLink, EventDetail } from "@/types";
import { formatDate, formatInstant, safeHostname } from "@/lib/format";
import { formatCoordinates } from "@/lib/coordinates";
import { conflictLabel } from "@/lib/conflicts";
import { renderProof } from "@/lib/proof";
import { SourceLabel } from "@/components/ui/SourceLabel";
import {
  ArchivedCopies,
  DETECTED_FROM_DESCRIPTION,
  PRIMARY_SOURCE_DESCRIPTION,
  mirrorDescription,
} from "@/components/ui/ArchivedCopies";
import { StatusBadge } from "@/components/event/StatusBadge";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ProofSection } from "@/components/ui/ProofSection";
import { Pill } from "@/components/ui/Pill";
import { TEXT_LINK } from "@/components/ui/styles";
import type { Concept } from "@/lib/fieldHelp";

/** The body's data shape: an `EventDetail` as-is. Every lifecycle state shares it: a coordless
 * `requested` row carries a null `event_coords`, and the missing detected-from and requested-by
 * spots drop out. */
export type EventDetailBodyData = EventDetail;

interface EventDetailBodyProps {
  geo: EventDetailBodyData;
  /**
   * `panel`: map's 380px overlay: stacked `thumbnail` media, bare rows, no request-trace or author
   * rows (the author is in the panel header). `page`: full detail page: 2-up `hero` media grid,
   * card-chrome rows plus request-trace and author rows, section headings.
   */
  variant: "panel" | "page";
  /** Rendered between the media block and the key-value rows (the full page slots its Location map here). */
  children?: ReactNode;
}

/** Geolocation markup shared by the map's detail side-panel and `events/[id]`; `variant` owns the
 * density differences so the field set can't drift. */
export function EventDetailBody({ geo, variant, children }: EventDetailBodyProps) {
  const compact = variant === "panel";
  return (
    <>
      <MediaBlock geo={geo} compact={compact} />
      {children}
      <DetailRows geo={geo} compact={compact} />
      <ProofBlock geo={geo} compact={compact} />
    </>
  );
}

function MediaBlock({ geo, compact }: { geo: EventDetailBodyData; compact: boolean }) {
  if (compact) {
    return (
      <div className="space-y-2">
        <SectionEyebrow
          as="h3"
          margin="none"
          title="Source media"
          concept="source_media"
        />
        <MediaGallery
          media={geo.media}
          alt={geo.title}
          variant="panel"
          isGraphic={geo.is_graphic}
        />
      </div>
    );
  }
  return (
    <div>
      <SectionEyebrow title="Source media" concept="source_media" />
      <MediaGallery media={geo.media} alt={geo.title} isGraphic={geo.is_graphic} />
    </div>
  );
}

function DetailRows({ geo, compact }: { geo: EventDetailBodyData; compact: boolean }) {
  // Conflicts and curated capture-source tags get labelled rows so they read as structured facts, not free-form chips.
  const captureTags = geo.tags.filter((t) => t.category === "capture_source");
  const freeTags = geo.tags.filter((t) => t.category === "free");
  const sourceClass = compact ? "" : "text-sm";
  const tagRow = (name: string, tags: EventDetailBodyData["tags"], concept?: Concept) =>
    tags.length > 0 ? (
      <DetailRow label={name} concept={concept} compact={compact} align="start">
        <div className={`flex flex-wrap ${compact ? "gap-1" : "gap-1.5"} justify-end`}>
          {tags.map((tag) => (
            <Pill key={tag.id} tone="neutral">
              {tag.name}
            </Pill>
          ))}
        </div>
      </DetailRow>
    ) : null;

  const rows = (
    <>
      <DetailRow label="Status" concept="status" compact={compact}>
        <StatusBadge status={geo.status} />
      </DetailRow>
      {/* The closer's free-text reason and closing day stay publicly visible on a closed row (why a
          request was withdrawn, a detection rejected or a geolocation retracted), on every surface
          that renders one. */}
      {geo.status === "closed" && geo.close_reason && (
        <DetailRow label="Reason" compact={compact} align="start">
          <span
            className={`${compact ? "" : "text-sm"} text-neutral-300 whitespace-pre-wrap text-right`}
          >
            {geo.close_reason}
          </span>
        </DetailRow>
      )}
      {geo.closed_at && (
        <DetailRow label="Closed" compact={compact} value={formatDate(geo.closed_at)} />
      )}
      <DetailRow
        label="Event date"
        concept="event_date"
        compact={compact}
        value={geo.event_date ? formatDate(geo.event_date) : "Unknown"}
      />
      {/* Time-of-day gets its own row: it can be known without the day (an hour from sun position or
          shadows), so it must show even when the date is "Unknown". Only when set. */}
      {geo.event_time && (
        <DetailRow
          label="Event time"
          concept="event_time"
          compact={compact}
          value={`${geo.event_time.slice(0, 5)} UTC`}
        />
      )}
      <DetailRow
        label="Source posted"
        concept="source_posted_at"
        compact={compact}
        value={formatInstant(geo.source_posted_at)}
      />
      {/* The three dates read as one block: event → source → submitted. */}
      <DetailRow
        label="Added"
        concept="added"
        compact={compact}
        value={formatDate(geo.created_at)}
      />
      <DetailRow label="Source" concept="source_url" compact={compact}>
        <span className="flex min-w-0 items-baseline justify-end">
          <SourceLabel
            url={geo.source_url}
            variant="link"
            className={sourceClass}
          />
          {geo.source_url && (
            <ArchivedCopies
              copy={geo.archived_source}
              describes={PRIMARY_SOURCE_DESCRIPTION}
            />
          )}
        </span>
      </DetailRow>
      {/* Mirrors of the same media, under the primary. Collapsed: corroboration, not the evidence
          anchor, so they don't push the Details block down. */}
      {geo.secondary_source_urls.length > 0 && (
        <SecondarySourcesRow
          urls={geo.secondary_source_urls}
          archived={geo.archived_secondary_sources}
          compact={compact}
        />
      )}
      {/* The post a machine import read this row from, distinct from Source (the footage origin). The
          bot writes it on requests as well as detections, and the label follows `requested_by`, the
          stamp that survives fulfilment, so it doesn't flip to "Detected from" once someone geolocates
          the row. */}
      {geo.detected_from_url && (
        <DetailRow
          label={geo.requested_by ? "Requested from" : "Detected from"}
          concept="detected_from"
          compact={compact}
        >
          <span className="flex min-w-0 items-baseline justify-end">
            {/* Same display as Source: SourceLabel reduces the URL to its host, so the two provenance rows
                read alike. */}
            <SourceLabel
              url={geo.detected_from_url}
              variant="link"
              className={sourceClass}
            />
            {/* Archived like the source: the analyst's post is the claim's provenance and rots the same way. */}
            <ArchivedCopies
              copy={geo.archived_detected_from}
              describes={DETECTED_FROM_DESCRIPTION}
            />
          </span>
        </DetailRow>
      )}
      {geo.conflicts.length > 0 && (
        <DetailRow label="Conflict" concept="conflict" compact={compact} align="start">
          <div className={`flex flex-wrap ${compact ? "gap-1" : "gap-1.5"} justify-end`}>
            {geo.conflicts.map((c) => (
              <Pill key={c.id} tone="neutral">
                {conflictLabel(c)}
              </Pill>
            ))}
          </div>
        </DetailRow>
      )}
      {tagRow("Capture source", captureTags, "capture_source")}
      {tagRow("Tags", freeTags)}
      {/* Compact panel omits requested-by and author rows: the author is in the panel header, the trace
          belongs to the full page. Fulfilment is a lifecycle move on this row, so the trace is who
          opened the request (`requested_by`). */}
      {!compact && geo.requested_by && (
        <DetailRow label="Requested by" concept="requested_by" compact={compact}>
          <Link
            href={`/profile/${geo.requested_by.username}`}
            className={`text-sm ${TEXT_LINK} truncate`}
          >
            @{geo.requested_by.username}
          </Link>
        </DetailRow>
      )}
      {!compact && (
        <DetailRow label="Author" concept="author" compact={compact}>
          <AuthorByline author={geo.owner} prefix={false} className="text-sm" />
        </DetailRow>
      )}
    </>
  );

  if (compact) {
    // Same sections as the page (no map in the panel, so Location is the coordinates), only denser.
    // Two fragment siblings: the parent's `space-y` separates them.
    return (
      <>
        <div className="space-y-2">
          <SectionEyebrow
            as="h3"
            margin="none"
            title="Location"
            concept="section_location"
          />
          <DetailRow
            label="Coordinates"
            concept="coordinates"
            compact
            className="text-sm"
          >
            <span className="text-neutral-200 font-mono text-xs">
              {geo.event_coords
                ? formatCoordinates(geo.event_coords.lat, geo.event_coords.lng)
                : "—"}
            </span>
          </DetailRow>
        </div>
        <div className="space-y-2">
          <SectionEyebrow
            as="h3"
            margin="none"
            title="Details"
            concept="section_details"
          />
          <div className="space-y-2 text-sm">{rows}</div>
        </div>
      </>
    );
  }
  return (
    <div>
      <SectionEyebrow title="Details" concept="section_details" />
      <DetailCard>{rows}</DetailCard>
    </div>
  );
}

/**
 * The Secondary sources row: a count that expands into the list. Rendered only for a non-empty
 * list (the caller guards). Each link is a `SourceLabel` with its `ArchivedCopies` mark, like the
 * Source row; the row's `?` explains the mark once. `archived` is index-aligned with `urls` (the
 * payload's contract).
 */
function SecondarySourcesRow({
  urls,
  archived,
  compact,
}: {
  urls: string[];
  archived: (ArchivedLink | null)[];
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const textSize = compact ? "" : "text-sm";
  return (
    <DetailRow
      label="Secondary sources"
      concept="secondary_source_urls"
      compact={compact}
      align="start"
    >
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`inline-flex items-center gap-1 ${textSize} ${TEXT_LINK}`}
        >
          {open ? (
            <>
              Hide
              <ChevronUp size={12} />
            </>
          ) : (
            <>
              {urls.length} more source{urls.length === 1 ? "" : "s"}
              <ChevronDown size={12} />
            </>
          )}
        </button>
        {open &&
          urls.map((url, index) => (
            // Index key: two mirrors may repeat a URL, and archival records pair by position.
            <span key={index} className="flex min-w-0 items-baseline justify-end">
              <SourceLabel
                url={url}
                variant="link"
                className={textSize}
              />
              {/* Named per mirror, not "the source": several archived copies can share a page, each needing its
                  own target announced. `mirrorDescription` owns the name, including the cases a bare host can't
                  carry (shared host, no host). */}
              <ArchivedCopies
                copy={archived[index] ?? null}
                describes={mirrorDescription(safeHostname(url), index, urls.length)}
              />
            </span>
          ))}
      </div>
    </DetailRow>
  );
}

function ProofBlock({ geo, compact }: { geo: EventDetailBodyData; compact: boolean }) {
  // A proof body carries pasted URLs; a full-URL link text is one unbreakable token that scrolled the
  // page sideways on a phone without an anywhere-break. One wrapper for both the page and the map
  // panel, so neither regresses alone.
  const body = geo.proof ? (
    <div className="text-sm text-neutral-300 leading-relaxed [overflow-wrap:anywhere]">
      {renderProof(geo.proof, { gateImages: geo.is_graphic })}
    </div>
  ) : (
    <p className="text-sm text-neutral-500 italic">No proof provided</p>
  );

  if (compact) {
    return (
      <div className="pt-2 border-t border-neutral-800">
        <SectionEyebrow
          as="h3"
          margin="sm"
          title="Proof"
          concept="section_proof"
        />
        {body}
      </div>
    );
  }
  return <ProofSection>{body}</ProofSection>;
}

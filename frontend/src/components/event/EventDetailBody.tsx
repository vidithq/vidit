"use client";

import type { ReactNode } from "react";

import type { EventDetail } from "@/types";
import { formatDate } from "@/lib/format";
import { formatCoordinates } from "@/lib/coordinates";
import { conflictLabel } from "@/lib/conflicts";
import { provenanceLabel } from "@/lib/events";
import { renderProof } from "@/lib/proof";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { StatusBadge } from "@/components/event/StatusBadge";
import { SourceBlocks, sourcesScroll } from "@/components/sources/SourceBlock";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailCard, DetailPills, DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import type { EventLayoutSlots } from "@/components/event/EventLayout";
import { ProofSection } from "@/components/ui/ProofSection";

/** The body's data shape: an `EventDetail` as-is. Every lifecycle state shares it: a coordless
 * `requested` row carries a null `coords`, and the missing detected-from and requested-by
 * spots drop out. */
export type EventDetailBodyData = EventDetail;

/** The map panel's body: one column, stacked sources with `thumbnail` media, bare rows, the proof
 * last, no request-trace row. The author is in the panel's header, so no row repeats it. */
export function EventDetailBody({ geo }: { geo: EventDetailBodyData }) {
  return (
    <>
      <SourceBlocks sources={geo.sources} alt={geo.title} compact />
      <DetailRows geo={geo} compact />
      <ProofBlock geo={geo} compact />
    </>
  );
}

/**
 * The same fields as `EventDetailBody`, for `EventShell`'s body on the event, version and request
 * pages: the sources as a sideways row with `hero` media, then the proof, in the main column;
 * `location`, then the Details card with the request-trace row, in the side column. One home for
 * the field set, so the panel and the pages can't drift.
 */
export function eventPageSlots(geo: EventDetailBodyData, location?: ReactNode): EventLayoutSlots {
  return {
    sources: <SourceBlocks sources={geo.sources} alt={geo.title} />,
    proof: <ProofBlock geo={geo} compact={false} />,
    details: (
      <DetailRows
        geo={geo}
        compact={false}
        besideScroller={sourcesScroll(geo.sources.length) && !location}
      />
    ),
    location,
  };
}

function DetailRows({
  geo,
  compact,
  besideScroller = false,
}: {
  geo: EventDetailBodyData;
  compact: boolean;
  besideScroller?: boolean;
}) {
  const sourceClass = compact ? "" : "text-sm";

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
        concept="occurred_date"
        compact={compact}
        value={geo.occurred_date ? formatDate(geo.occurred_date) : "Unknown"}
      />
      {/* Time-of-day gets its own row: it can be known without the day (an hour from sun position or
          shadows), so it must show even when the date is "Unknown". Only when set. */}
      {geo.occurred_time && (
        <DetailRow
          label="Event time"
          concept="occurred_time"
          compact={compact}
          value={`${geo.occurred_time.slice(0, 5)} UTC`}
        />
      )}
      {/* The two dates read as one block: event, then submitted. */}
      <DetailRow
        label="Added"
        concept="added"
        compact={compact}
        value={formatDate(geo.created_at)}
      />
      {/* The post a machine import read this row from, distinct from the sources (where the footage was posted). */}
      {geo.detected_from_url && (
        <DetailRow
          label={provenanceLabel(!!geo.requested_by)}
          concept="detected_from"
          compact={compact}
        >
          <span className="flex min-w-0 items-baseline justify-end">
            <SourceLabel
              url={geo.detected_from_url}
              variant="link"
              className={sourceClass}
            />
          </span>
        </DetailRow>
      )}
      {geo.conflicts.length > 0 && (
        <DetailRow label="Conflict" concept="conflict" compact={compact} align="start">
          <DetailPills
            items={geo.conflicts.map((c) => ({ id: c.id, name: conflictLabel(c) }))}
            compact={compact}
          />
        </DetailRow>
      )}
      {geo.tags.length > 0 && (
        <DetailRow label="Tags" compact={compact} align="start">
          <DetailPills items={geo.tags} compact={compact} />
        </DetailRow>
      )}
      {/* The trace belongs to the full page. Fulfilment is a lifecycle move on this row, so the
          trace is who opened the request (`requested_by`). */}
      {!compact && geo.requested_by && (
        <DetailRow label="Requested by" concept="requested_by" compact={compact}>
          <AuthorByline author={geo.requested_by} prefix={false} className="text-sm" />
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
            {geo.coords ? (
              <span className="text-neutral-200 font-mono text-xs">
                {formatCoordinates(geo.coords.lat, geo.coords.lng)}
              </span>
            ) : (
              <span className="text-neutral-200">Unknown</span>
            )}
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
      <SectionEyebrow
        title="Details"
        concept="section_details"
        besideScroller={besideScroller}
      />
      <DetailCard>{rows}</DetailCard>
    </div>
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

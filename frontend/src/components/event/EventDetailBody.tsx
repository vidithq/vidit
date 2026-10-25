"use client";

import type { EventDetail } from "@/types";
import { formatDate, hhmm } from "@/lib/format";
import { formatCoordinates } from "@/lib/coordinates";
import { conflictLabel } from "@/lib/conflicts";
import { EVENT_FIELDS, provenanceLabel } from "@/lib/events";
import { renderProof } from "@/lib/proof";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { StatusBadge } from "@/components/event/StatusBadge";
import { SourceBlocks } from "@/components/sources/SourceBlock";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailCard, DetailPills, DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EVENT_SECTIONS, type EventLayoutSlots, type EventSlot } from "@/components/event/EventLayout";
import { ProofSection } from "@/components/ui/ProofSection";

/** The map panel's body: one column, stacked sources with `thumbnail` media, bare rows, the proof
 * last, no request-trace row. The author is in the panel's header, so no row repeats it. */
export function EventDetailBody({ geo }: { geo: EventDetail }) {
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
export function eventPageSlots(geo: EventDetail, location?: EventSlot | null): EventLayoutSlots {
  return {
    sources: <SourceBlocks sources={geo.sources} alt={geo.title} />,
    proof: { content: <ProofBlock geo={geo} compact={false} /> },
    details: { content: <DetailRows geo={geo} compact={false} /> },
    location,
  };
}

function DetailRows({ geo, compact }: { geo: EventDetail; compact: boolean }) {
  const sourceClass = compact ? "" : "text-sm";

  const rows = (
    <>
      <DetailRow {...EVENT_FIELDS.status} compact={compact}>
        <StatusBadge status={geo.status} />
      </DetailRow>
      {/* The closer's free-text reason and closing day stay publicly visible on a closed row (why a
          request was withdrawn, a detection rejected or a geolocation retracted), on every surface
          that renders one. */}
      {geo.status === "closed" && geo.close_reason && (
        <DetailRow {...EVENT_FIELDS.close_reason} compact={compact} align="start">
          <span
            className={`${compact ? "" : "text-sm"} text-neutral-300 whitespace-pre-wrap text-right`}
          >
            {geo.close_reason}
          </span>
        </DetailRow>
      )}
      {geo.closed_at && (
        <DetailRow {...EVENT_FIELDS.closed_at} compact={compact} value={formatDate(geo.closed_at)} />
      )}
      <DetailRow
        {...EVENT_FIELDS.occurred_date}
        compact={compact}
        value={geo.occurred_date ? formatDate(geo.occurred_date) : "Unknown"}
      />
      {/* Time-of-day gets its own row: it can be known without the day (an hour from sun position or
          shadows), so it must show even when the date is "Unknown". Only when set. */}
      {geo.occurred_time && (
        <DetailRow
          {...EVENT_FIELDS.occurred_time}
          compact={compact}
          value={`${hhmm(geo.occurred_time)} UTC`}
        />
      )}
      {/* The two dates read as one block: event, then submitted. */}
      <DetailRow
        {...EVENT_FIELDS.created_at}
        compact={compact}
        value={formatDate(geo.created_at)}
      />
      {/* The post a machine import read this row from, distinct from the sources (where the footage was posted). */}
      {geo.detected_from_url && (
        <DetailRow
          {...EVENT_FIELDS.detected_from}
          label={provenanceLabel(!!geo.requested_by)}
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
        <DetailRow {...EVENT_FIELDS.conflicts} compact={compact} align="start">
          <DetailPills
            items={geo.conflicts.map((c) => ({ id: c.id, name: conflictLabel(c) }))}
            compact={compact}
          />
        </DetailRow>
      )}
      {geo.tags.length > 0 && (
        <DetailRow {...EVENT_FIELDS.tags} compact={compact} align="start">
          <DetailPills items={geo.tags} compact={compact} />
        </DetailRow>
      )}
      {/* The trace belongs to the full page. Fulfilment is a lifecycle move on this row, so the
          trace is who opened the request (`requested_by`). */}
      {!compact && geo.requested_by && (
        <DetailRow {...EVENT_FIELDS.requested_by} compact={compact}>
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
          <SectionEyebrow as="h3" margin="none" {...EVENT_SECTIONS.location} />
          <DetailRow
            {...EVENT_FIELDS.coordinates}
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
          <SectionEyebrow as="h3" margin="none" {...EVENT_SECTIONS.details} />
          <div className="space-y-2 text-sm">{rows}</div>
        </div>
      </>
    );
  }
  return <DetailCard>{rows}</DetailCard>;
}

function ProofBlock({ geo, compact }: { geo: EventDetail; compact: boolean }) {
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
        <SectionEyebrow as="h3" margin="sm" {...EVENT_SECTIONS.proof} />
        {body}
      </div>
    );
  }
  return <ProofSection>{body}</ProofSection>;
}

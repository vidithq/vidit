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
import { SourceBlocks } from "@/components/sources/SourceBlock";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ProofSection } from "@/components/ui/ProofSection";
import { Pill } from "@/components/ui/Pill";
import { creditProps } from "@/lib/geolocatorCredit";

/** The body's data shape: an `EventDetail` as-is. Every lifecycle state shares it: a coordless
 * `requested` row carries a null `coords`, and the missing detected-from and requested-by
 * spots drop out. */
export type EventDetailBodyData = EventDetail;

interface EventDetailBodyProps {
  geo: EventDetailBodyData;
  /**
   * `panel`: map's 380px overlay: stacked sources with `thumbnail` media, bare rows, no
   * request-trace or author rows (the author is in the panel header). `page`: full detail page: a
   * sideways row of sources with `hero` media, card-chrome rows plus request-trace and author rows,
   * section headings.
   */
  variant: "panel" | "page";
  /** Rendered between the sources and the key-value rows (the full page slots its Location map here). */
  children?: ReactNode;
}

/** Geolocation markup shared by the map's detail side-panel and `events/[id]`; `variant` owns the
 * density differences so the field set can't drift. */
export function EventDetailBody({ geo, variant, children }: EventDetailBodyProps) {
  const compact = variant === "panel";
  return (
    <>
      <SourceBlocks sources={geo.sources} alt={geo.title} compact={compact} />
      {children}
      <DetailRows geo={geo} compact={compact} />
      <ProofBlock geo={geo} compact={compact} />
    </>
  );
}

function DetailRows({ geo, compact }: { geo: EventDetailBodyData; compact: boolean }) {
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
          <div className={`flex flex-wrap ${compact ? "gap-1" : "gap-1.5"} justify-end`}>
            {geo.conflicts.map((c) => (
              <Pill key={c.id} tone="neutral">
                {conflictLabel(c)}
              </Pill>
            ))}
          </div>
        </DetailRow>
      )}
      {geo.tags.length > 0 && (
        <DetailRow label="Tags" compact={compact} align="start">
          <div className={`flex flex-wrap ${compact ? "gap-1" : "gap-1.5"} justify-end`}>
            {geo.tags.map((tag) => (
              <Pill key={tag.id} tone="neutral">
                {tag.name}
              </Pill>
            ))}
          </div>
        </DetailRow>
      )}
      {/* Compact panel omits requested-by and author rows: the author is in the panel header, the trace
          belongs to the full page. Fulfilment is a lifecycle move on this row, so the trace is who
          opened the request (`requested_by`). */}
      {!compact && geo.requested_by && (
        <DetailRow label="Requested by" concept="requested_by" compact={compact}>
          <AuthorByline author={geo.requested_by} prefix={false} className="text-sm" />
        </DetailRow>
      )}
      {!compact && (
        <DetailRow label="Author" concept="author" compact={compact}>
          <AuthorByline {...creditProps(geo)} prefix={false} className="text-sm" />
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
              {geo.coords
                ? formatCoordinates(geo.coords.lat, geo.coords.lng)
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

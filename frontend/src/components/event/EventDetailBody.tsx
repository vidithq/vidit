"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import type { EventDetail } from "@/types";
import { formatDate, formatEventDate, formatInstant } from "@/lib/format";
import { sourceIsSynthetic } from "@/lib/events";
import { renderProof } from "@/lib/proof";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { StatusBadge } from "@/components/event/StatusBadge";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ProofSection } from "@/components/ui/ProofSection";
import { Pill } from "@/components/ui/Pill";
import { TEXT_LINK } from "@/components/ui/styles";
import type { Concept } from "@/lib/fieldHelp";

/**
 * The body's data shape: an `EventDetail` as-is. Every lifecycle state
 * (located, detected, requested, closed) shares this one shape: a coordless
 * `requested` row just carries a null `event_coords`, and the missing
 * detected-from / requested-by spots drop out with no extra branching.
 */
export type EventDetailBodyData = EventDetail;

interface EventDetailBodyProps {
  geo: EventDetailBodyData;
  /**
   * ``panel`` — map's 380px overlay: stacked ``thumbnail`` media, bare rows,
   * no bounty-trace/author rows (the author sits in the panel header).
   * ``page`` — full detail page: 2-up ``hero`` media grid, card-chrome rows
   * plus bounty-trace + author rows, section headings.
   */
  variant: "panel" | "page";
  /** Rendered between the media block and the key-value rows — the
   *  full page slots its Location map here. */
  children?: ReactNode;
  /** Extra DetailRows appended to the Details section, where the bounty view
   *  slots its "Working on" and "Closed" rows. */
  detailExtras?: ReactNode;
}

/**
 * Geolocation markup shared by the map's detail side-panel and
 * `events/[id]`. The `variant` prop owns the density differences so the
 * field set can't drift between the two surfaces.
 */
export function EventDetailBody({
  geo,
  variant,
  children,
  detailExtras,
}: EventDetailBodyProps) {
  const compact = variant === "panel";
  return (
    <>
      <MediaBlock geo={geo} compact={compact} />
      {children}
      <DetailRows geo={geo} compact={compact} detailExtras={detailExtras} />
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
        <MediaGallery media={geo.media} alt={geo.title} variant="panel" />
      </div>
    );
  }
  return (
    <div>
      <SectionEyebrow title="Source media" concept="source_media" />
      <MediaGallery media={geo.media} alt={geo.title} />
    </div>
  );
}

function DetailRows({
  geo,
  compact,
  detailExtras,
}: {
  geo: EventDetailBodyData;
  compact: boolean;
  detailExtras?: ReactNode;
}) {
  // Curated tags (conflict, capture source) get their own labelled rows so
  // they read as structured facts, not free-form chips lost in one row.
  const conflictTags = geo.tags.filter((t) => t.category === "conflict");
  const captureTags = geo.tags.filter((t) => t.category === "capture_source");
  const freeTags = geo.tags.filter((t) => t.category === "free");
  const sourceMaxWidth = compact ? "max-w-[200px]" : "max-w-[300px]";
  const sourceClass = compact ? "ml-4" : "text-sm ml-4";
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
        <StatusBadge
          status={geo.status}
          beforeClosedStatus={geo.before_closed_status}
        />
      </DetailRow>
      {/* The closer's free-text reason, kept publicly visible on a closed row
          (transparency: why the request was withdrawn or the detection
          rejected). Sits next to the Status badge. */}
      {geo.status === "closed" && geo.close_reason && (
        <DetailRow label="Reason" compact={compact} align="start">
          <span
            className={`${compact ? "" : "text-sm"} text-neutral-300 whitespace-pre-wrap text-right ml-4 max-w-[300px]`}
          >
            {geo.close_reason}
          </span>
        </DetailRow>
      )}
      <DetailRow
        label="Event date"
        concept="event_date"
        compact={compact}
        value={
          geo.event_date ? formatEventDate(geo.event_date, geo.event_time) : "—"
        }
      />
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
        <SourceLabel
          isDemo={sourceIsSynthetic(geo)}
          url={geo.source_url}
          variant="link"
          maxWidthClass={sourceMaxWidth}
          className={sourceClass}
        />
      </DetailRow>
      {/* The post a detection was imported from, distinct from Source (the
          footage origin), never folded into it. */}
      {geo.detected_from_url && (
        <DetailRow label="Detected from" concept="detected_from" compact={compact}>
          {/* Same display nature as Source: SourceLabel reduces the URL to its
              host, so the two provenance rows read alike rather than one
              host-reduced, one truncated-full. A detected row's provenance link
              shows even in demo data (see sourceIsSynthetic). */}
          <SourceLabel
            isDemo={sourceIsSynthetic(geo)}
            url={geo.detected_from_url}
            variant="link"
            maxWidthClass={sourceMaxWidth}
            className={sourceClass}
          />
        </DetailRow>
      )}
      {tagRow("Conflict", conflictTags, "conflict")}
      {tagRow("Capture source", captureTags, "capture_source")}
      {tagRow("Tags", freeTags)}
      {/* Compact panel omits requested-by + author rows: the author is in
          the panel header, the trace belongs to the full page. Since the merge,
          fulfilment is a lifecycle move on this same row, so the trace is who
          opened the request (``requested_by``), not a link to a separate bounty. */}
      {!compact && geo.requested_by && (
        <DetailRow label="Requested by" compact={compact}>
          <Link
            href={`/profile/${geo.requested_by.username}`}
            className={`text-sm ${TEXT_LINK} truncate ml-4 max-w-[300px]`}
          >
            @{geo.requested_by.username}
          </Link>
        </DetailRow>
      )}
      {!compact && (
        <DetailRow label="Author" compact={compact}>
          <AuthorByline author={geo.owner} prefix={false} className="text-sm" />
        </DetailRow>
      )}
      {detailExtras}
    </>
  );

  if (compact) {
    // Same section structure as the page (the panel has no map, so Location is
    // just the coordinates), so the side-panel reads like the full page, only
    // denser. Two fragment siblings → the parent panel's `space-y` separates them.
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
                ? `${geo.event_coords.lat.toFixed(6)}, ${geo.event_coords.lng.toFixed(6)}`
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
  const body = geo.proof ? (
    <div className="text-sm text-neutral-300 leading-relaxed">
      {renderProof(geo.proof)}
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

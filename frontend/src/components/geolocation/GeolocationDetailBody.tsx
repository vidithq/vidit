"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

import type { GeolocationDetail } from "@/types";
import { formatDate, formatEventDate, formatInstant } from "@/lib/format";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { sourceIsSynthetic } from "@/lib/geolocations";
import { renderProof } from "@/lib/proof";
import SourceLabel from "@/components/ui/SourceLabel";
import StatusBadge from "@/components/geolocation/StatusBadge";
import FieldHelp from "@/components/ui/FieldHelp";
import TrustBadge from "@/components/profile/TrustBadge";
import { TAG_CHIP, TEXT_LINK } from "@/components/ui/styles";
import type { Concept } from "@/lib/fieldHelp";

// Compact (map side-panel) section eyebrow — same role as the page variant's
// `h2`, denser and without the page's `mb-3` (the panel's `space-y` owns rhythm).
const COMPACT_HEADING =
  "text-xs text-neutral-500 uppercase tracking-wider inline-flex items-center gap-1.5";

interface GeolocationDetailBodyProps {
  geo: GeolocationDetail;
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
}

/**
 * Geolocation markup shared by the map's detail side-panel and
 * `geolocations/[id]`. The `variant` prop owns the density differences so the
 * field set can't drift between the two surfaces.
 */
export function GeolocationDetailBody({
  geo,
  variant,
  children,
}: GeolocationDetailBodyProps) {
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

function MediaBlock({ geo, compact }: { geo: GeolocationDetail; compact: boolean }) {
  const itemHeight = compact ? "h-40" : "h-48";
  const items = geo.media.map((m) => (
    <div
      key={m.id}
      className={`relative ${itemHeight} rounded-lg overflow-hidden border border-neutral-700${
        compact ? "" : " bg-neutral-900"
      }`}
    >
      {m.media_type === "image" ? (
        // Resolution per surface. The panel (~380 CSS px) is the most-fetched
        // surface — every map popup — so ``thumbnail`` (max-dim 400) avoids
        // bleeding bandwidth. Detail-page cards (~384 CSS px) use ``hero``
        // (max-dim 1280) to stay sharp at 2x DPI without the original's
        // multi-megabyte payload.
        <Image
          src={compact ? displayUrlsFor(m).thumbnail : displayUrlsFor(m).hero}
          alt={geo.title}
          fill
          sizes={compact ? "380px" : "(min-width: 768px) 384px, 100vw"}
          className="object-cover"
        />
      ) : (
        <video
          src={m.storage_url}
          controls
          className={`w-full ${itemHeight} object-cover`}
        />
      )}
    </div>
  ));

  const empty = (
    <div
      className={`rounded-lg border border-neutral-700 bg-neutral-800 ${itemHeight} flex items-center justify-center`}
    >
      <span className={`${compact ? "text-xs" : "text-sm"} text-neutral-500`}>
        No media available
      </span>
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-2">
        <h3 className={COMPACT_HEADING}>
          Source media
          <FieldHelp concept="source_media" />
        </h3>
        {geo.media.length > 0 ? items : empty}
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3 inline-flex items-center gap-1.5">
        Source media
        <FieldHelp concept="source_media" />
      </h2>
      {geo.media.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{items}</div>
      ) : (
        empty
      )}
    </div>
  );
}

function DetailRows({ geo, compact }: { geo: GeolocationDetail; compact: boolean }) {
  const row = compact ? "flex justify-between" : "flex justify-between px-4 py-3";
  const rowStart = compact
    ? "flex justify-between items-start"
    : "flex justify-between items-start px-4 py-3";
  const label = compact ? "text-neutral-500" : "text-sm text-neutral-500";
  const value = compact ? "text-neutral-200" : "text-sm text-neutral-200";

  // Curated tags (conflict, capture source) get their own labelled rows so
  // they read as structured facts, not free-form chips lost in one row.
  const conflictTags = geo.tags.filter((t) => t.category === "conflict");
  const captureTags = geo.tags.filter((t) => t.category === "capture_source");
  const freeTags = geo.tags.filter((t) => t.category === "free");
  const tagRow = (name: string, tags: GeolocationDetail["tags"], concept?: Concept) =>
    tags.length > 0 ? (
      <div className={rowStart}>
        <span className={concept ? `${label} inline-flex items-center gap-1` : label}>
          {name}
          {concept && <FieldHelp concept={concept} />}
        </span>
        <div className={`flex flex-wrap ${compact ? "gap-1" : "gap-1.5"} justify-end`}>
          {tags.map((tag) => (
            <span
              key={tag.id}
              className={`${
                compact ? "text-[10px] px-2" : "text-xs px-2.5"
              } py-0.5 rounded-full ${TAG_CHIP}`}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </div>
    ) : null;

  const rows = (
    <>
      <div className={row}>
        <span className={`${label} inline-flex items-center gap-1`}>
          Status <FieldHelp concept="status" />
        </span>
        <StatusBadge status={geo.status} />
      </div>
      <div className={row}>
        <span className={`${label} inline-flex items-center gap-1`}>
          Event date <FieldHelp concept="event_date" />
        </span>
        <span className={value}>{formatEventDate(geo.event_date, geo.event_time)}</span>
      </div>
      <div className={row}>
        <span className={`${label} inline-flex items-center gap-1`}>
          Source posted{" "}
          <FieldHelp concept="source_posted_at" />
        </span>
        <span className={value}>{formatInstant(geo.source_posted_at)}</span>
      </div>
      {/* The three dates read as one block: event → source → submitted. */}
      <div className={row}>
        <span className={`${label} inline-flex items-center gap-1`}>
          Added <FieldHelp concept="added" />
        </span>
        <span className={value}>{formatDate(geo.created_at)}</span>
      </div>
      <div className={row}>
        <span className={`${label} inline-flex items-center gap-1`}>
          Source <FieldHelp concept="source_url" />
        </span>
        <SourceLabel
          isDemo={sourceIsSynthetic(geo)}
          url={geo.source_url}
          variant="link"
          maxWidthClass={compact ? "max-w-[200px]" : "max-w-[300px]"}
          className={compact ? "ml-4" : "text-sm ml-4"}
        />
      </div>
      {/* The post a detection was imported from, distinct from Source (the
          footage origin), never folded into it. */}
      {geo.detected_from_url && (
        <div className={row}>
          <span className={`${label} inline-flex items-center gap-1`}>
            Detected from{" "}
            <FieldHelp concept="detected_from" />
          </span>
          {/* Same display nature as Source: SourceLabel reduces the URL to its
              host, so the two provenance rows read alike rather than one
              host-reduced, one truncated-full. A detected row's provenance link
              shows even in demo data (see sourceIsSynthetic). */}
          <SourceLabel
            isDemo={sourceIsSynthetic(geo)}
            url={geo.detected_from_url}
            variant="link"
            maxWidthClass={compact ? "max-w-[200px]" : "max-w-[300px]"}
            className={compact ? "ml-4" : "text-sm ml-4"}
          />
        </div>
      )}
      {tagRow("Conflict", conflictTags, "conflict")}
      {tagRow("Capture source", captureTags, "capture_source")}
      {tagRow("Tags", freeTags)}
      {/* Compact panel omits bounty-trace + author rows: the author is in
          the panel header, the trace belongs to the full page. */}
      {!compact && geo.originated_from_bounty && (
        <div className={row}>
          <span className={label}>Bounty</span>
          <Link
            href={`/bounties/${geo.originated_from_bounty.id}`}
            className={`text-sm ${TEXT_LINK} truncate ml-4 max-w-[300px]`}
          >
            {geo.originated_from_bounty.title}
          </Link>
        </div>
      )}
      {!compact && (
        <div className={row}>
          <span className={label}>Author</span>
          <span className="text-sm inline-flex items-center gap-1.5">
            <Link
              href={`/profile/${geo.author.username}`}
              className={`${TEXT_LINK} transition-colors`}
            >
              {geo.author.username}
            </Link>
            <TrustBadge
              isTrusted={geo.author.is_trusted}
              trustReason={geo.author.trust_reason}
              size={14}
            />
          </span>
        </div>
      )}
    </>
  );

  if (compact) {
    // Same section structure as the page (the panel has no map, so Location is
    // just the coordinates), so the side-panel reads like the full page, only
    // denser. Two fragment siblings → the parent panel's `space-y` separates them.
    return (
      <>
        <div className="space-y-2">
          <h3 className={COMPACT_HEADING}>
            Location
            <FieldHelp concept="section_location" />
          </h3>
          <div className={`${row} text-sm`}>
            <span className={`${label} inline-flex items-center gap-1`}>
              Coordinates <FieldHelp concept="coordinates" />
            </span>
            <span className={`${value} font-mono text-xs`}>
              {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)}
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <h3 className={COMPACT_HEADING}>
            Details
            <FieldHelp concept="section_details" />
          </h3>
          <div className="space-y-2 text-sm">{rows}</div>
        </div>
      </>
    );
  }
  return (
    <div>
      <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3 inline-flex items-center gap-1.5">
        Details
        <FieldHelp concept="section_details" />
      </h2>
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 divide-y divide-neutral-800">
        {rows}
      </div>
    </div>
  );
}

function ProofBlock({ geo, compact }: { geo: GeolocationDetail; compact: boolean }) {
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
        <h3 className="text-xs text-neutral-500 uppercase tracking-wider mb-1.5 inline-flex items-center gap-1.5">
          Proof
          <FieldHelp concept="section_proof" />
        </h3>
        {body}
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3 inline-flex items-center gap-1.5">
        Proof
        <FieldHelp concept="section_proof" />
      </h2>
      <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-700">
        {body}
      </div>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

import type { GeolocationDetail } from "@/types";
import { formatDate } from "@/lib/format";
import { displayUrlsFor } from "@/lib/mediaUrls";
import { renderProof } from "@/lib/proof";
import SourceLabel from "@/components/ui/SourceLabel";
import TrustBadge from "@/components/profile/TrustBadge";
import { TAG_CHIP } from "@/components/ui/styles";

interface GeolocationDetailBodyProps {
  geo: GeolocationDetail;
  /**
   * ``panel`` — the map's 380px side overlay: stacked media at
   * ``thumbnail`` resolution, bare key-value rows, no bounty-trace or
   * author rows (the author sits in the panel header).
   * ``page`` — the full detail page: 2-up media grid at ``hero``
   * resolution, card-chrome key-value rows plus the bounty-trace and
   * author rows, and a section heading over each block.
   */
  variant: "panel" | "page";
  /** Rendered between the media block and the key-value rows — the
   *  full page slots its Location map here. */
  children?: ReactNode;
}

/**
 * The geolocation markup shared by the map's detail side-panel and
 * `geolocations/[id]` — media, key-value fields, and the proof body.
 * The two surfaces deliberately differ in density (overlay vs full
 * page); the `variant` prop owns those differences so the field set
 * itself can never drift between them again.
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
        // Resolution per surface: the panel renders at ~380 CSS px on
        // the most-fetched surface in the app (every popup open on
        // every map session), so ``thumbnail`` (max-dim 400) is the
        // intentional fit — ``hero`` there would bleed bandwidth. The
        // detail-page gallery cards render at ~384 CSS px inside
        // max-w-4xl; ``hero`` (max-dim 1280) covers a 2x-DPI fetch
        // sharply without the original's multi-megabyte payload.
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
    return <div className="space-y-2">{geo.media.length > 0 ? items : empty}</div>;
  }
  return (
    <div>
      <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
        Media
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

  const rows = (
    <>
      <div className={row}>
        <span className={label}>Event date</span>
        <span className={value}>{formatDate(geo.event_date)}</span>
      </div>
      <div className={row}>
        <span className={label}>Coordinates</span>
        <span className={`${value} font-mono${compact ? " text-xs" : ""}`}>
          {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)}
        </span>
      </div>
      <div className={row}>
        <span className={label}>Source</span>
        <SourceLabel
          isDemo={geo.is_demo}
          url={geo.source_url}
          variant="link"
          maxWidthClass={compact ? "max-w-[200px]" : "max-w-[300px]"}
          className={compact ? "ml-4" : "text-sm ml-4"}
        />
      </div>
      {geo.tags.length > 0 && (
        <div className={rowStart}>
          <span className={label}>Tags</span>
          <div
            className={`flex flex-wrap ${compact ? "gap-1" : "gap-1.5"} justify-end`}
          >
            {geo.tags.map((tag) => (
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
      )}
      <div className={row}>
        <span className={label}>Submitted</span>
        <span className={value}>{formatDate(geo.created_at)}</span>
      </div>
      {/* The compact panel deliberately omits the bounty-trace and
          author rows: the author already sits in the panel header, and
          the trace belongs to the full page. */}
      {!compact && geo.originated_from_bounty && (
        <div className={row}>
          <span className={label}>Bounty</span>
          <Link
            href={`/bounties/${geo.originated_from_bounty.id}`}
            className="text-sm text-orange-400 hover:underline truncate ml-4 max-w-[300px]"
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
              className="text-orange-400 hover:underline transition-colors"
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
    return <div className="space-y-2 text-sm">{rows}</div>;
  }
  return (
    <div>
      <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
        Details
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
        <h3 className="text-xs text-neutral-500 uppercase tracking-wider mb-1.5">
          Proof
        </h3>
        {body}
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">
        Proof
      </h2>
      <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-700">
        {body}
      </div>
    </div>
  );
}

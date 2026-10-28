"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { ApiResource } from "@/hooks/useApiResource";
import { cn } from "@/lib/cn";
import { formatCoordinates } from "@/lib/coordinates";
import { EVENT_FIELDS } from "@/lib/events";
import type { Concept } from "@/lib/fieldHelp";
import type { Source } from "@/lib/sources";
import { TEXT_LINK } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { Button } from "@/components/ui/Button";
import { CARD_FRAME } from "@/components/ui/Card";
import { DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EVENT_SECTIONS } from "@/components/event/EventLayout";
import { SourceBlocks } from "@/components/sources/SourceBlock";

/** What one record shows in the map's side panel, an event's or a site's. */
export interface MapPanelContent {
  /** The record's name, linked to its page. */
  title: string;
  href: string;
  /** The line under the title: who documents the record. */
  byline: ReactNode;
  /** The Sources block, as the event page's source blocks. */
  sources: Source[];
  /** The Location block's Coordinates row; null reads Unknown. */
  coords: { lat: number; lng: number } | null;
  /** The `?` of the Location and Details eyebrows and of the Coordinates row, the event's when
   *  absent. */
  concepts?: { location: Concept; details: Concept; coordinates: Concept };
  /** The Details block's rows. */
  details: ReactNode;
  /** A block after the Details, the event's proof. */
  footer?: ReactNode;
}

const EVENT_CONCEPTS = {
  location: EVENT_SECTIONS.location.concept,
  details: EVENT_SECTIONS.details.concept,
  coordinates: EVENT_FIELDS.coordinates.concept,
};

export interface MapSidePanelProps<T> {
  /** The read from `useApiResource`: one prop so no caller drops the error. `data` is null while
   * loading or after a failed load. */
  resource: ApiResource<T>;
  onClose: () => void;
  /** The error line when the read fails with no message. */
  errorFallback: string;
  content: (data: T) => MapPanelContent;
}

/** The panel's blocks under its heading: the sources, the event page's Location and Details
 *  sections, only denser, then the footer. */
export function MapPanelBody({
  content: { title, sources, coords, concepts = EVENT_CONCEPTS, details, footer },
}: {
  content: MapPanelContent;
}) {
  return (
    <>
      <SourceBlocks sources={sources} alt={title} compact />
      <div className="space-y-2">
        <SectionEyebrow
          as="h3"
          margin="none"
          title={EVENT_SECTIONS.location.title}
          concept={concepts.location}
        />
        <DetailRow
          {...EVENT_FIELDS.coordinates}
          concept={concepts.coordinates}
          compact
          className="text-sm"
        >
          {coords ? (
            <span className="text-neutral-200 font-mono text-xs">
              {formatCoordinates(coords.lat, coords.lng)}
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
          title={EVENT_SECTIONS.details.title}
          concept={concepts.details}
        />
        <div className="space-y-2 text-sm">{details}</div>
      </div>
      {footer}
    </>
  );
}

/**
 * The map's side panel, for an event and a site alike: the record's name linked to its page, the
 * byline under it, then `MapPanelBody`. `max-h-[calc(100dvh-4.5rem)]`, not a pinned `bottom-14`, so
 * the panel shrinks to its content yet caps and scrolls when long (4.5rem = top-4 plus 3.5rem
 * clearance for the bottom pill). `dvh` so the cap follows the iOS URL bar.
 *
 * Below `sm` it is a bottom sheet: a 384px card pinned right runs off a 375px viewport. It spans
 * the width, caps at 60dvh, scrolls its own content, and covers the map's zoom control while open.
 *
 * The display cutout is part of the box (docs/design.md, Phone chrome): margins from `sm` up, and
 * padding on the sheet's three edges.
 */
export function MapSidePanel<T>({
  resource,
  onClose,
  errorFallback,
  content,
}: MapSidePanelProps<T>) {
  const { data, error, loading, refetch } = resource;

  const panel = data ? content(data) : null;

  return (
    <div
      className={cn(
        CARD_FRAME,
        "overflow-y-auto absolute top-4 right-4 sm:safe-mt sm:safe-mr max-h-[calc(100dvh-4.5rem)] z-1000 w-96 max-sm:top-auto max-sm:bottom-0 max-sm:inset-x-0 max-sm:w-auto max-sm:max-h-[60dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:safe-pb max-sm:safe-pl max-sm:safe-pr max-sm:border-b-0",
      )}
    >
      {/* Sheet grab bar (phone): the sheet has no top edge against the map. Centred to clear the
          close button; decorative. */}
      <div className="sm:hidden flex justify-center py-2" aria-hidden="true">
        <div className="h-1 w-9 rounded-full bg-neutral-600" />
      </div>

      <Button
        icon
        variant="ghost"
        onClick={onClose}
        aria-label="Close detail panel"
        title="Close detail panel"
        className="absolute top-3 right-3 z-10 text-lg"
      >
        &times;
      </Button>

      {error !== null ? (
        // `min-h-32` matches the loading box so the chrome holds still; `pr-12` clears the close button.
        <div className="p-4 space-y-3 min-h-32 pr-12">
          <div className={FORM_ERROR_BANNER} role="alert">
            {error || errorFallback}
          </div>
          <Button action="retry" variant="secondary" onClick={refetch}>
            Retry
          </Button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center h-full min-h-32">
          <span className="text-neutral-500 text-sm">Loading...</span>
        </div>
      ) : panel ? (
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            {/* `pr-6` on the heading alone: the absolute close button overlaps it, and the byline
                stays flush. The title is an explicit TEXT_LINK permalink; no external glyph
                (ArchivedCopies marks external only). */}
            <h2 className="text-lg font-medium pr-6">
              <Link href={panel.href} className={`text-neutral-100 ${TEXT_LINK}`}>
                {panel.title}
                {/* ArrowRight, the in-app navigation glyph; inline so it rides the last line of a wrapped title. */}
                <ArrowRight size={14} className="ml-1 inline align-[-2px]" />
              </Link>
            </h2>
            <p className="text-xs text-neutral-400">{panel.byline}</p>
          </div>
          <MapPanelBody content={panel} />
        </div>
      ) : null}
    </div>
  );
}

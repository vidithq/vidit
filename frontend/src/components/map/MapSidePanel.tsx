"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { ApiResource } from "@/hooks/useApiResource";
import { cn } from "@/lib/cn";
import { TEXT_LINK } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { Button } from "@/components/ui/Button";
import { CARD_FRAME } from "@/components/ui/Card";

export interface MapSidePanelProps<T> {
  /** The read from `useApiResource`: one prop so no caller drops the error. `data` is null while
   * loading or after a failed load. */
  resource: ApiResource<T>;
  onClose: () => void;
  /** The error line when the read fails with no message. */
  errorFallback: string;
  /** The record's name, linked to its page, and the line under it (a byline, a kind). */
  heading: (data: T) => { title: string; href: string; meta: ReactNode };
  /** The rest of the panel, under the heading. */
  children: (data: T) => ReactNode;
}

/**
 * The map's side panel, for an event and a site alike: the record's name linked to its page and a
 * line under it, then what the caller renders. `max-h-[calc(100dvh-4.5rem)]`, not a pinned `bottom-14`, so the
 * panel shrinks to its content yet caps and scrolls when long (4.5rem = top-4 plus 3.5rem clearance
 * for the bottom pill). `dvh` so the cap follows the iOS URL bar.
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
  heading,
  children,
}: MapSidePanelProps<T>) {
  const { data, error, loading, refetch } = resource;

  const head = data ? heading(data) : null;

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
          <Button variant="secondary" onClick={refetch}>
            Retry
          </Button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center h-full min-h-32">
          <span className="text-neutral-500 text-sm">Loading...</span>
        </div>
      ) : data && head ? (
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            {/* `pr-6` on the heading alone: the absolute close button overlaps it, and the line under it
                stays flush. The title is an explicit TEXT_LINK permalink; no external glyph
                (ArchivedCopies marks external only). */}
            <h2 className="text-lg font-medium pr-6">
              <Link href={head.href} className={`text-neutral-100 ${TEXT_LINK}`}>
                {head.title}
                {/* ArrowRight, the in-app navigation glyph; inline so it rides the last line of a wrapped title. */}
                <ArrowRight size={14} className="ml-1 inline align-[-2px]" />
              </Link>
            </h2>
            {head.meta}
          </div>
          {children(data)}
        </div>
      ) : null}
    </div>
  );
}

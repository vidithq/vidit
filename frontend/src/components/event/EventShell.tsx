"use client";

import type { ReactNode } from "react";

import { PageShell } from "@/components/ui/PageShell";
import { EventLayout, type EventLayoutSlots } from "@/components/event/EventLayout";

/**
 * The one shell of an event: the event page, a version page, the request page, the edit form and
 * the submit form all render it and only fill its slots. To move a block, change this shell or
 * `EventLayout`, never a page.
 *
 * The header (back arrow, `title`, `byline`) heads the main column. `actions` are the page's sticky
 * actions, top right, pinned while the page scrolls. `sideTop` heads the side column under them,
 * level with the title. `panels` take the full width under the header. `body` fills the
 * `EventLayout` grid; without it the page stops after the panels (a redacted version).
 */
export function EventShell({
  title,
  byline,
  backFallback,
  onBack,
  actions,
  sideTop,
  panels,
  body,
}: {
  title: ReactNode;
  byline?: ReactNode;
  /** Where Back lands when the session has nothing to return to (`smartBack`'s fallback). */
  backFallback?: string;
  /** Replaces Back's history walk (a submit path returns to its chooser). */
  onBack?: () => void;
  actions?: ReactNode;
  /** The approvals and an invitation on the event page, a version's approvals, the version note
   *  of a published row's edit. */
  sideTop?: ReactNode;
  /** The panels the actions open, a version's banner. */
  panels?: ReactNode;
  body?: EventLayoutSlots;
}) {
  return (
    <PageShell
      back
      backFallback={backFallback}
      onBack={onBack}
      title={title}
      subtitle={byline}
      stickyActions={actions}
      headerSide={sideTop ?? null}
    >
      {panels}
      {body && <EventLayout {...body} />}
    </PageShell>
  );
}

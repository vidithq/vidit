"use client";

import type { ReactNode } from "react";

import { PageShell } from "@/components/ui/PageShell";
import { EventLayout, type EventLayoutSlots } from "@/components/event/EventLayout";

/** The actions block, top right: the row pinned while the page scrolls, then what reads under it. */
export interface EventShellActions {
  /** The row of buttons (or a form's writes and banners), the only part pinned on scroll. */
  pinned: ReactNode;
  /** Under the row, not pinned: the approvals on the event page, a version's
   *  approvals, a form's hidden announcer. */
  below?: ReactNode;
}

/**
 * The one shell of an event: the event page, a version page, the request page, the edit form and
 * the submit form all render it and only fill its slots (zones in `docs/design.md`, Event
 * layout). To move a block, change this shell or `EventLayout`, never a page. Without `body` the
 * page stops after `panels` (a redacted version).
 */
export function EventShell({
  title,
  titleField,
  byline,
  backFallback,
  onBack,
  actions,
  panels,
  body,
}: {
  /** The event title, or a form's page name, which `titleField` hides. */
  title: ReactNode;
  /** A form's Title field, in the event title's place. Outside the `<form>`, so it joins it
   *  through its `form` attribute. */
  titleField?: ReactNode;
  byline?: ReactNode;
  /** Where Back lands when the session has nothing to return to (`smartBack`'s fallback). */
  backFallback?: string;
  /** Replaces Back's history walk (a submit path returns to its chooser). */
  onBack?: () => void;
  actions?: EventShellActions;
  /** The panels the actions open, a version's banner. */
  panels?: ReactNode;
  body?: EventLayoutSlots;
}) {
  return (
    <>
      {/* A form's page name leaves the screen, so the browser tab carries it (React hoists the
          tag into the head). */}
      {titleField && typeof title === "string" && <title>{`${title} on Vidit`}</title>}
      <PageShell
        back
        backFallback={backFallback}
        onBack={onBack}
        title={title}
        titleField={titleField}
        subtitle={byline}
        stickyActions={actions?.pinned}
        headerSide={actions?.below ?? null}
      >
        {panels}
        {body && <EventLayout {...body} />}
      </PageShell>
    </>
  );
}

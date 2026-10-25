"use client";

import type { ReactNode } from "react";

import { PageShell } from "@/components/ui/PageShell";
import { EventLayout, type EventLayoutSlots } from "@/components/event/EventLayout";

/** The actions block, top right: the row pinned while the page scrolls, then what reads under it. */
export interface EventShellActions {
  /** The row of buttons (or a form's writes and banners), the only part pinned on scroll. */
  pinned: ReactNode;
  /** Under the row, not pinned: the approvals and an invitation on the event page, a version's
   *  approvals, the version note of a published row's edit. */
  below?: ReactNode;
}

/**
 * The one shell of an event: the event page, a version page, the request page, the edit form and
 * the submit form all render it and only fill its three zones. To move a block, change this shell
 * or `EventLayout`, never a page.
 *
 * 1. **Title section**, heading the main column: back, the title (a form's `titleField`, with
 *    `title` as its visually hidden page heading), then `byline`.
 * 2. **Actions block**, top right, heading the side column: `actions.pinned`, pinned while the
 *    page scrolls, then `actions.below`, which scrolls with the page.
 * 3. **Body**: `body` fills the `EventLayout` grid; without it the page stops after the panels (a
 *    redacted version).
 *
 * `panels` take the full width between the title section and the body.
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

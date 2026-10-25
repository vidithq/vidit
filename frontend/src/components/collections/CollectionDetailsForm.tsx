"use client";

import dynamic from "next/dynamic";
import { useId, useState, type ReactNode } from "react";

import { EventPicker } from "@/components/collections/EventPicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CharCounter } from "@/components/ui/CharCounter";
import { CountBadge } from "@/components/ui/CountBadge";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import { Input } from "@/components/ui/Input";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  FORM_ERROR_BANNER,
  FORM_INVALID_LABEL,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import { cn } from "@/lib/cn";
import {
  COLLECTION_DESCRIPTION_MAX_LEN,
  COLLECTION_TITLE_MAX_LEN,
  type CollectionDescription,
  type PickableEvent,
} from "@/lib/collections";
import { missingSummary } from "@/lib/events";
import { htmlText } from "@/lib/proof";

// BlockNote needs the DOM.
const ProofEditor = dynamic(() => import("@/components/editor/ProofEditor"), {
  ssr: false,
});

const EMPTY_DESCRIPTION: CollectionDescription = "";

type CollectionField = "title" | "description";

/** What the submit still refuses, one entry per field: blank, or past its cap. */
function missingCollectionFields(
  title: string,
  descriptionText: string,
): { key: CollectionField; label: string }[] {
  const missing: { key: CollectionField; label: string }[] = [];
  if (!title.trim()) missing.push({ key: "title", label: "Title" });
  else if (title.length > COLLECTION_TITLE_MAX_LEN) {
    missing.push({
      key: "title",
      label: `Title (${COLLECTION_TITLE_MAX_LEN} characters at most)`,
    });
  }
  if (!descriptionText) missing.push({ key: "description", label: "Description" });
  else if (descriptionText.length > COLLECTION_DESCRIPTION_MAX_LEN) {
    missing.push({
      key: "description",
      label: `Description (${COLLECTION_DESCRIPTION_MAX_LEN} characters at most)`,
    });
  }
  return missing;
}

/**
 * The one page behind every collection write (`/collections/new` and
 * `/collections/{id}/edit`): title, description, and which of the analyst's
 * events it holds. A caller passes the page's header and the starting values,
 * and is handed all three on submit.
 *
 * It renders the `PageShell`: **Cancel** and the submit in its sticky actions,
 * then the *Details* card and `<EventPicker>`'s two cards in one `<form>`. The
 * submit sits outside the form and joins it through the form's `id`, so Enter
 * in the title still submits.
 *
 * Title and description are required. The submit stays clickable and carries a
 * `<CountBadge>` of what it still refuses (a blank or over-long value). A click
 * on an incomplete form submits nothing: it turns those fields red until they
 * are filled, and `IncompleteFormAnnouncer` reads the gaps to a screen reader.
 *
 * **The description is written in `<ProofEditor>`** with `allowImages={false}`
 * (no upload path, and the server drops the node). The form holds the HTML
 * body, and its counter measures the plain-text projection (`htmlText`),
 * the reading the server caps, so markup costs nothing.
 *
 * The pending event set is rows, not ids, because the first card renders what
 * the collection will hold. It is seeded from `initialEvents` and handed back
 * as ids on submit.
 */
export function CollectionDetailsForm({
  title: pageTitle,
  subtitle,
  backFallback,
  initialTitle = "",
  initialDescription = EMPTY_DESCRIPTION,
  initialEvents = [],
  username,
  hint,
  submitLabel,
  onSubmit,
  onCancel,
  busy = false,
  error,
}: {
  /** The page's heading. */
  title: string;
  subtitle?: ReactNode;
  /** Where Back lands when the session has nothing to return to. */
  backFallback: string;
  /** Seed for an edit; empty for a create. */
  initialTitle?: string;
  /** The editor reads it once, at construction. */
  initialDescription?: CollectionDescription;
  /** The current items on an edit, the `?event=` event on a create. */
  initialEvents?: PickableEvent[];
  /** Whose events the picker lists: the signed-in analyst. */
  username: string;
  /** A line under the fields (the create page). */
  hint?: string;
  /** The verb: *Create collection*, *Save collection*, *Create and add*. */
  submitLabel: string;
  onSubmit: (
    title: string,
    description: CollectionDescription,
    eventIds: string[],
  ) => void;
  onCancel: () => void;
  /** The caller's write is in flight. */
  busy?: boolean;
  error?: string | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [events, setEvents] = useState<PickableEvent[]>(initialEvents);
  // Counts blocked submits: 0 shows no flags, and each new attempt replays the notice.
  const [attempt, setAttempt] = useState(0);
  const formId = useId();
  const titleId = useId();
  const descriptionId = useId();

  // Pending state only; the guard keeps a held row from printing twice.
  const addEvent = (event: PickableEvent) =>
    setEvents((current) =>
      current.some((held) => held.id === event.id)
        ? current
        : [...current, event],
    );
  const removeEvent = (eventId: string) =>
    setEvents((current) => current.filter((held) => held.id !== eventId));

  // Plain-text projection, as `services/collections` measures it server-side.
  const descriptionText = htmlText(description);
  const titleOver = title.length > COLLECTION_TITLE_MAX_LEN;
  const descriptionOver =
    descriptionText.length > COLLECTION_DESCRIPTION_MAX_LEN;
  const missing = missingCollectionFields(title, descriptionText);
  // An over-long value is red as soon as it is typed, like its counter; a blank one after a blocked submit.
  const flagged = (key: CollectionField) =>
    attempt > 0 && missing.some((m) => m.key === key);
  const titleInvalid = titleOver || flagged("title");
  const descriptionInvalid = descriptionOver || flagged("description");

  const actions = (
    <aside aria-label="Actions" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <CountBadge count={missing.length} label={missingSummary(missing)}>
          {(describedBy) => (
            <Button
              type="submit"
              form={formId}
              variant="primary"
              disabled={busy}
              aria-describedby={describedBy}
            >
              {busy ? "Saving…" : submitLabel}
            </Button>
          )}
        </CountBadge>
      </div>
      <IncompleteFormAnnouncer
        attempt={attempt}
        missing={attempt > 0 ? missing.map((m) => m.label) : []}
      />
      {error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {error}
        </div>
      )}
    </aside>
  );

  return (
    <PageShell
      back
      backFallback={backFallback}
      title={pageTitle}
      subtitle={subtitle}
      stickyActions={actions}
    >
      <form
        id={formId}
        className="space-y-6"
        // `noValidate`: the red outlines and IncompleteFormAnnouncer own required-field feedback.
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (missing.length > 0) {
            setAttempt((n) => n + 1);
            return;
          }
          onSubmit(
            title.trim(),
            description,
            events.map((event) => event.id),
          );
        }}
      >
        <Card as="section">
          <SectionHeading title="Details" />

          <div className="space-y-1.5">
            <span className="flex items-center justify-between gap-2">
              <label
                htmlFor={titleId}
                className={cn(FORM_LABEL, titleInvalid && FORM_INVALID_LABEL)}
              >
                Title
              </label>
              <CharCounter length={title.length} max={COLLECTION_TITLE_MAX_LEN} />
            </span>
            <Input
              id={titleId}
              value={title}
              invalid={titleInvalid}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Kupiansk rail corridor: three days of strikes"
            />
          </div>

          <div className="space-y-1.5">
            <span className="flex items-center justify-between gap-2">
              {/* The editor is a contenteditable div, not a form control, so the label
                  names it through `aria-labelledby` on the wrapper. */}
              <span
                id={descriptionId}
                className={cn(FORM_LABEL, descriptionInvalid && FORM_INVALID_LABEL)}
              >
                Description
              </span>
              <CharCounter
                length={descriptionText.length}
                max={COLLECTION_DESCRIPTION_MAX_LEN}
              />
            </span>
            <div role="group" aria-labelledby={descriptionId}>
              <ProofEditor
                initialContent={initialDescription}
                onChange={setDescription}
                allowImages={false}
                invalid={descriptionInvalid}
              />
            </div>
            {hint && (
              <span className="block text-xs text-neutral-500">{hint}</span>
            )}
          </div>
        </Card>

        <EventPicker
          username={username}
          events={events}
          onAdd={addEvent}
          onRemove={removeEvent}
        />
      </form>
    </PageShell>
  );
}

"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useState, type ComponentProps } from "react";

import { HeldCoverage } from "@/components/collections/CollectionCoverage";
import { CollectionDetails, CollectionShell } from "@/components/collections/CollectionShell";
import { EventPicker } from "@/components/collections/EventPicker";
import { TitleField } from "@/components/geolocations/TitleField";
import { Button, type ButtonAction } from "@/components/ui/Button";
import { CharCounter } from "@/components/ui/CharCounter";
import { CountBadge } from "@/components/ui/CountBadge";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
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
 * The one page behind every collection write (`/collections/new` and `/collections/{id}/edit`):
 * title, description, and which of the analyst's events it holds. A caller passes the page name,
 * the owner and the starting values, and is handed all three on submit.
 *
 * It fills `CollectionShell`, the collection page's columns: the Title field in the title's place,
 * **Cancel** and the submit pinned top right, the Description and `<EventPicker>`'s two cards in
 * the main column, and in the side column the held events on the map and the Details they add
 * up to. The submit and the Title field sit outside the `<form>` and join it through its `id`, so
 * Enter in the title still submits.
 *
 * Title and description are required. The submit stays clickable and carries a `<CountBadge>` of
 * what it still refuses (a blank or over-long value). A click on an incomplete form submits
 * nothing: it turns those fields red until they are filled, and `IncompleteFormAnnouncer` reads
 * the gaps to a screen reader.
 *
 * **The description is written in `<ProofEditor>`** with `allowImages={false}` (no upload path,
 * and the server drops the node). The form holds the HTML body, and its counter measures the
 * plain-text projection (`htmlText`), the reading the server caps, so markup costs nothing.
 *
 * The pending event set is rows, not ids, because the held card and the map render what the
 * collection will hold. It is seeded from `initialEvents` and handed back as ids on submit.
 *
 * `matched` is a search match the caller adds after the save, shown a page at a time in the held
 * card (`EventPicker`). Its rows are not the form's: removing one goes to the caller, and the ids
 * handed back on submit are the picks alone. Details counts the whole match, and states the span
 * once every matched row has loaded.
 */
export function CollectionDetailsForm({
  title: pageTitle,
  owner,
  backFallback,
  initialTitle = "",
  initialDescription = EMPTY_DESCRIPTION,
  initialEvents = [],
  username,
  hint,
  submitLabel,
  submitAction,
  onSubmit,
  onCancel,
  busy = false,
  error,
  matched,
  onEventsChange,
}: {
  /** The page's name: a visually hidden `h1` and the browser tab's title. */
  title: string;
  /** Whose collection it is: the byline under the title. */
  owner: ComponentProps<typeof CollectionShell>["owner"];
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
  /** A line under the description (the create page). */
  hint?: string;
  /** The verb: *Create collection*, *Save collection*, *Create and add*. */
  submitLabel: string;
  /** The action the verb names: *newCollection* for a create, *save* for an edit. */
  submitAction: ButtonAction;
  onSubmit: (
    title: string,
    description: CollectionDescription,
    eventIds: string[],
  ) => void;
  onCancel: () => void;
  /** The caller's write is in flight. */
  busy?: boolean;
  error?: string | null;
  /** A search match the caller adds after the save (`EventPicker`'s `matched`). */
  matched?: ComponentProps<typeof EventPicker>["matched"];
  /** The held count, each time it changes, for a caller whose submit label follows it. */
  onEventsChange?: (count: number) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [events, setEvents] = useState<PickableEvent[]>(initialEvents);
  useEffect(() => {
    onEventsChange?.(events.length);
  }, [events.length, onEventsChange]);
  // Counts blocked submits: 0 shows no flags, and each new attempt replays the notice.
  const [attempt, setAttempt] = useState(0);
  const formId = useId();

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

  // What the save holds, for the map and Details: the picks, then the matched rows loaded so far.
  const held = matched ? [...events, ...matched.rows] : events;
  const dates = held.flatMap((event) => (event.occurred_date ? [event.occurred_date] : [])).sort();
  const spanKnown = !matched?.walk.hasMore;

  const actions = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button action="cancel" type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <CountBadge count={missing.length} label={missingSummary(missing)}>
          {(describedBy) => (
            <Button
              action={submitAction}
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
      {error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {error}
        </div>
      )}
    </div>
  );

  return (
    <CollectionShell
      title={pageTitle}
      titleField={
        <TitleField
          value={title}
          onChange={setTitle}
          invalid={titleInvalid}
          form={formId}
          placeholder="Title, e.g. Kupiansk rail corridor: three days of strikes"
          concept="collection_title"
          maxLength={COLLECTION_TITLE_MAX_LEN}
        />
      }
      owner={owner}
      backFallback={backFallback}
      actions={actions}
      below={
        <IncompleteFormAnnouncer
          attempt={attempt}
          missing={attempt > 0 ? missing.map((m) => m.label) : []}
        />
      }
      form={{
        id: formId,
        // `noValidate`: the red outlines and IncompleteFormAnnouncer own required-field feedback.
        noValidate: true,
        onSubmit: (e) => {
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
        },
      }}
      main={
        <>
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <SectionEyebrow title="Description" margin="none" invalid={descriptionInvalid} />
              <CharCounter
                length={descriptionText.length}
                max={COLLECTION_DESCRIPTION_MAX_LEN}
              />
            </div>
            {/* The editor is a contenteditable div, not a form control, so the group names it. */}
            <div role="group" aria-label="Description">
              <ProofEditor
                initialContent={initialDescription}
                onChange={setDescription}
                allowImages={false}
                invalid={descriptionInvalid}
              />
            </div>
            {hint && <p className="mt-1.5 text-xs text-neutral-500">{hint}</p>}
          </section>

          <EventPicker
            username={username}
            events={events}
            onAdd={addEvent}
            onRemove={removeEvent}
            matched={matched}
          />
        </>
      }
      side={
        <>
          <HeldCoverage events={held} />
          <CollectionDetails
            count={events.length + (matched?.total ?? 0)}
            first={spanKnown ? (dates[0] ?? null) : null}
            last={spanKnown ? (dates[dates.length - 1] ?? null) : null}
          />
        </>
      }
    />
  );
}

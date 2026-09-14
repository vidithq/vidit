"use client";

import { useId, useState } from "react";

import { EventPicker } from "@/components/collections/EventPicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CharCounter } from "@/components/ui/CharCounter";
import { Input, Textarea } from "@/components/ui/Input";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import {
  COLLECTION_DESCRIPTION_MAX_LEN,
  COLLECTION_TITLE_MAX_LEN,
  type PickableEvent,
} from "@/lib/collections";

/**
 * The one form behind every collection write: what the collection is called,
 * what it says it holds, and which of the analyst's events it holds.
 *
 * Both write pages carry it, `/collections/new` and `/collections/{id}/edit`,
 * so opening a collection and changing one are the same form with a different
 * verb on the button, and a per-page copy is how the counters, the caps and
 * the refusals end up spelled twice. The drafts live here: a caller passes the
 * values it starts from and is handed all three on submit.
 *
 * **It renders its own two cards.** *Details* holds the two free-text fields,
 * and *Events* holds the picker plus the one Save / Cancel row, past the
 * picker's own two blocks and before the edit page's separate Drop card. One
 * component owns the state and the submit either way, so the create and edit
 * pages hand it their values and render nothing of the form themselves.
 *
 * The two free-text fields are required, so the submit refuses a blank or
 * over-long value on either rather than letting the server answer 422 on text
 * the analyst has already typed. Each carries the shared `remaining / cap`
 * counter (`<CharCounter>`), which turns red exactly when the submit starts
 * refusing.
 *
 * **The picker sits in the Events card** (`<EventPicker>`), because the set is
 * part of what the analyst is writing: naming a collection and choosing what
 * goes on it is one act on one page. The pending set is rows rather than ids,
 * since the picker's first block renders what the collection will hold: it is
 * seeded from `initialEvents` (the collection's current items on an edit, the
 * event a `?event=` create arrived with) and handed back as ids on submit, so
 * the caller writes the create or the diff rather than tracking clicks.
 */
export function CollectionDetailsForm({
  initialTitle = "",
  initialDescription = "",
  initialEvents = [],
  username,
  hint,
  submitLabel,
  onSubmit,
  onCancel,
  busy = false,
  error,
}: {
  /** Seed for an edit; empty for a create. */
  initialTitle?: string;
  /** Seed for an edit; empty for a create. */
  initialDescription?: string;
  /** What the collection holds when the form opens: its current items on an
   *  edit, the one event a `?event=` create carries, none otherwise. */
  initialEvents?: PickableEvent[];
  /** Whose events the picker lists: the signed-in analyst, since a collection
   *  holds its owner's own work. */
  username: string;
  /** A line under the fields, where the surface has room to say what they are
   *  for (the create page). */
  hint?: string;
  /** The verb: *Create collection*, *Save details*, *Create and add*. */
  submitLabel: string;
  onSubmit: (title: string, description: string, eventIds: string[]) => void;
  onCancel: () => void;
  /** The caller's write is in flight: both controls refuse the click. */
  busy?: boolean;
  /** The caller's write failed, in the one error banner. */
  error?: string | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [events, setEvents] = useState<PickableEvent[]>(initialEvents);
  const titleId = useId();
  const descriptionId = useId();

  // Both acts are pending state: nothing is written until the caller's submit
  // runs, and adding a row already held is the same set, so the guard keeps
  // the block from printing it twice.
  const addEvent = (event: PickableEvent) =>
    setEvents((current) =>
      current.some((held) => held.id === event.id)
        ? current
        : [...current, event],
    );
  const removeEvent = (eventId: string) =>
    setEvents((current) => current.filter((held) => held.id !== eventId));

  const titleOver = title.length > COLLECTION_TITLE_MAX_LEN;
  const descriptionOver = description.length > COLLECTION_DESCRIPTION_MAX_LEN;
  const ready =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    !titleOver &&
    !descriptionOver;

  return (
    <>
      <Card as="section">
        <SectionEyebrow title="Details" margin="none" />

        <div className="space-y-1.5">
          <span className="flex items-center justify-between gap-2">
            <label htmlFor={titleId} className={FORM_LABEL}>
              Title
            </label>
            <CharCounter length={title.length} max={COLLECTION_TITLE_MAX_LEN} />
          </span>
          <Input
            id={titleId}
            value={title}
            invalid={titleOver}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Kupiansk rail corridor: three days of strikes"
          />
        </div>

        <div className="space-y-1.5">
          <span className="flex items-center justify-between gap-2">
            <label htmlFor={descriptionId} className={FORM_LABEL}>
              Description
            </label>
            <CharCounter
              length={description.length}
              max={COLLECTION_DESCRIPTION_MAX_LEN}
            />
          </span>
          <Textarea
            id={descriptionId}
            value={description}
            invalid={descriptionOver}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this collection holds: the place, the period, the kind of work."
            className="min-h-[72px] resize-y"
          />
          {hint && (
            <span className="block text-xs text-neutral-500">{hint}</span>
          )}
        </div>
      </Card>

      <Card as="section">
        <SectionEyebrow title="Events" margin="none" />

        <EventPicker
          username={username}
          events={events}
          onAdd={addEvent}
          onRemove={removeEvent}
        />

        {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!ready || busy}
            onClick={() =>
              onSubmit(
                title.trim(),
                description.trim(),
                events.map((event) => event.id),
              )
            }
          >
            {busy ? "Saving…" : submitLabel}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Card>
    </>
  );
}

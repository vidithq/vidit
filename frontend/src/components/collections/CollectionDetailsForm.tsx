"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";

import { EventPicker } from "@/components/collections/EventPicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CharCounter } from "@/components/ui/CharCounter";
import { Input } from "@/components/ui/Input";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import {
  COLLECTION_DESCRIPTION_MAX_LEN,
  COLLECTION_TITLE_MAX_LEN,
  type CollectionDescription,
  type PickableEvent,
} from "@/lib/collections";
import { tiptapDocText } from "@/lib/proof";

// The same dynamic load the submit form's proof panel takes: Tiptap boots
// ProseMirror, which needs the DOM, so it stays off the server render.
const ProofEditor = dynamic(() => import("@/components/editor/ProofEditor"), {
  ssr: false,
});

/** A description with nothing in it, which is what a create opens on. */
const EMPTY_DESCRIPTION: CollectionDescription = { type: "doc", content: [] };

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
 * **It renders three cards, plus the page's own action row past them.**
 * *Details* holds the two free-text fields, `<EventPicker>` renders the other
 * two as *Events in this collection* and *Add events*, and the Save / Cancel
 * row sits below all three, the way the submit and event edit pages place
 * theirs: past the last field block rather than inside it. One `<form>` wraps
 * every card, so Enter in a field submits like it does on those pages, and the
 * primary button is `type="submit"` rather than a bare click handler. One
 * component owns the state and the submit either way, so the create and edit
 * pages hand it their values and render nothing of the form themselves.
 *
 * The two written fields are required, so the submit refuses a blank or
 * over-long value on either rather than letting the server refuse text the
 * analyst has already typed. Each carries the shared `remaining / cap`
 * counter (`<CharCounter>`), which turns red exactly when the submit starts
 * refusing.
 *
 * **The description is written in the proof editor**, the same `<ProofEditor>`
 * an event's proof body uses, with `allowImages={false}`: a description carries
 * bold, italic, lists and links, and no images, because there is no upload path
 * behind one and the server drops the node. What the form holds and hands back
 * is the Tiptap document, not a string. Its counter measures the document's
 * plain-text projection (`tiptapDocText`), the same reading the server caps, so
 * marking a word up costs the analyst nothing.
 *
 * **The picker renders its own two cards** (`<EventPicker>`), because the set
 * is part of what the analyst is writing: naming a collection and choosing
 * what goes on it is one act on one page. The pending set is rows rather than
 * ids, since the first card renders what the collection will hold: it is
 * seeded from `initialEvents` (the collection's current items on an edit, the
 * event a `?event=` create arrived with) and handed back as ids on submit, so
 * the caller writes the create or the diff rather than tracking clicks.
 */
export function CollectionDetailsForm({
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
  /** Seed for an edit; empty for a create. */
  initialTitle?: string;
  /** The collection's own document on an edit; an empty one for a create. The
   *  editor reads it once, at construction. */
  initialDescription?: CollectionDescription;
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
  onSubmit: (
    title: string,
    description: CollectionDescription,
    eventIds: string[],
  ) => void;
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

  // The cap and the blank test both read the document's plain-text projection,
  // the reading `services/collections` measures server-side, so the counter,
  // the disabled submit and the server's refusal all agree on the same number.
  const descriptionText = tiptapDocText(description);
  const titleOver = title.length > COLLECTION_TITLE_MAX_LEN;
  const descriptionOver =
    descriptionText.length > COLLECTION_DESCRIPTION_MAX_LEN;
  const ready =
    title.trim().length > 0 &&
    descriptionText.length > 0 &&
    !titleOver &&
    !descriptionOver;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || busy) return;
        onSubmit(
          title.trim(),
          description,
          events.map((event) => event.id),
        );
      }}
    >
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
            {/* The editor's typing surface is a ProseMirror div rather than a
                form control, so the label names it through `htmlFor` /
                `aria-labelledby` on the wrapper instead of wrapping it. */}
            <span id={descriptionId} className={FORM_LABEL}>
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
              invalid={descriptionOver}
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

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

      {/* The page's own action row, past all three cards, the way the submit
          and event edit pages place theirs. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={!ready || busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

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

// Tiptap boots ProseMirror, which needs the DOM.
const ProofEditor = dynamic(() => import("@/components/editor/ProofEditor"), {
  ssr: false,
});

const EMPTY_DESCRIPTION: CollectionDescription = { type: "doc", content: [] };

/**
 * The one form behind every collection write (`/collections/new` and
 * `/collections/{id}/edit`): title, description, and which of the analyst's
 * events it holds. A caller passes the starting values and is handed all three
 * on submit.
 *
 * It renders the *Details* card, `<EventPicker>`'s two cards, and the Save /
 * Cancel row past them, all in one `<form>` so Enter submits.
 *
 * Title and description are required; the submit refuses a blank or over-long
 * value rather than letting the server refuse typed text. Each carries a
 * `<CharCounter>` that turns red exactly when the submit starts refusing.
 *
 * **The description is written in `<ProofEditor>`** with `allowImages={false}`
 * (no upload path, and the server drops the node). The form holds the Tiptap
 * document, and its counter measures the plain-text projection (`tiptapDocText`),
 * the reading the server caps, so markup costs nothing.
 *
 * The pending event set is rows, not ids, because the first card renders what
 * the collection will hold. It is seeded from `initialEvents` and handed back
 * as ids on submit.
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
  /** The editor reads it once, at construction. */
  initialDescription?: CollectionDescription;
  /** The current items on an edit, the `?event=` event on a create. */
  initialEvents?: PickableEvent[];
  /** Whose events the picker lists: the signed-in analyst. */
  username: string;
  /** A line under the fields (the create page). */
  hint?: string;
  /** The verb: *Create collection*, *Save details*, *Create and add*. */
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
            {/* The editor is a ProseMirror div, not a form control, so the label
                names it through `aria-labelledby` on the wrapper. */}
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

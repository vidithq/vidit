"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { CharCounter } from "@/components/ui/CharCounter";
import { Input, Textarea } from "@/components/ui/Input";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import {
  COLLECTION_DESCRIPTION_MAX_LEN,
  COLLECTION_TITLE_MAX_LEN,
} from "@/lib/collections";

/**
 * The one form behind every collection write that takes its details: the create
 * panel on the profile, the edit panel on the collection page, and the
 * add-to-collection panel's *New collection* row.
 *
 * A collection carries two free-text fields, the title and a short description
 * of what it holds, so all three surfaces are the same pair with a different
 * verb on the button, and a per-caller copy is how the counters, the caps and
 * the refusals end up spelled three ways. The drafts live here: a caller passes
 * the values it starts from and is handed both on submit.
 *
 * Both fields are required, so the submit refuses a blank or over-long value on
 * either rather than letting the server answer 422 on text the analyst has
 * already typed. Each carries the shared `remaining / cap` counter
 * (`<CharCounter>`), which turns red exactly when the submit starts refusing.
 */
export function CollectionDetailsForm({
  initialTitle = "",
  initialDescription = "",
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
  /** A line under the fields, where the surface has room to say what they are
   *  for (the create panel). */
  hint?: string;
  /** The verb: *Create collection*, *Save details*, *Create and add*. */
  submitLabel: string;
  onSubmit: (title: string, description: string) => void;
  onCancel: () => void;
  /** The caller's write is in flight: both controls refuse the click. */
  busy?: boolean;
  /** The caller's write failed, in the one error banner. */
  error?: string | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const titleId = useId();
  const descriptionId = useId();

  const titleOver = title.length > COLLECTION_TITLE_MAX_LEN;
  const descriptionOver = description.length > COLLECTION_DESCRIPTION_MAX_LEN;
  const ready =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    !titleOver &&
    !descriptionOver;

  return (
    <div className="space-y-4">
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
        {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!ready || busy}
          onClick={() => onSubmit(title.trim(), description.trim())}
        >
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

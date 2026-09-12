"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";
import { COLLECTION_TITLE_MAX_LEN } from "@/lib/collections";

/**
 * The one title form behind every collection write that takes a title: the
 * create panel on the profile, the rename on the collection page, and the
 * add-to-collection panel's *New collection* row.
 *
 * A collection carries one free-text field, so all three are the same field
 * with a different verb on the button, and a per-caller copy is how the
 * counter, the cap and the empty-title refusal end up spelled three ways. The
 * draft lives here: a caller passes the value it starts from and is handed the
 * title on submit.
 *
 * The counter is the profile bio's, `remaining / cap` turning red once the
 * value runs over, and the submit refuses an empty or over-long title rather
 * than letting the server answer 422 on a title the analyst has already typed.
 */
export function CollectionTitleForm({
  initialTitle = "",
  hint,
  submitLabel,
  onSubmit,
  onCancel,
  busy = false,
  error,
}: {
  /** Seed for a rename; empty for a create. */
  initialTitle?: string;
  /** A line under the field, where the surface has room to say what the field
   *  is for (the create panel). */
  hint?: string;
  /** The verb: *Create collection*, *Save title*, *Create and add*. */
  submitLabel: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
  /** The caller's write is in flight: both controls refuse the click. */
  busy?: boolean;
  /** The caller's write failed, in the one error banner. */
  error?: string | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const fieldId = useId();
  const remaining = COLLECTION_TITLE_MAX_LEN - title.length;
  const over = remaining < 0;
  const ready = title.trim().length > 0 && !over;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="flex items-center justify-between gap-2">
          <label htmlFor={fieldId} className={FORM_LABEL}>
            Title
          </label>
          <span
            className={`text-[11px] ${over ? "text-red-400" : "text-neutral-500"}`}
          >
            {remaining} / {COLLECTION_TITLE_MAX_LEN}
          </span>
        </span>
        <Input
          id={fieldId}
          value={title}
          invalid={over}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Kupiansk rail corridor: three days of strikes"
          onKeyDown={(e) => {
            // One field, so Enter is the submit: the form is a line and a
            // button, and reaching for the mouse to commit a title you just
            // typed is a step the surface does not need.
            if (e.key === "Enter" && ready && !busy) onSubmit(title.trim());
          }}
        />
        {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      </div>

      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!ready || busy}
          onClick={() => onSubmit(title.trim())}
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

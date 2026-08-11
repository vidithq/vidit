"use client";

import { Plus, X } from "lucide-react";

import { Button } from "./Button";
import { Input } from "./Input";

// An ordered list of URL fields: one <Input> per entry, a remove affordance on
// each, and one add button under them. Composes the existing <Input> and
// <Button> primitives; the list mechanics (append, edit at index, remove at
// index, the cap) are the only thing it owns.
//
// Blank rows are kept in state while the analyst types; callers drop them when
// they assemble their payload, so an untouched row never posts.

interface LinkListInputProps {
  /** The ordered URLs, blank entries included (a row still being typed). */
  values: string[];
  onChange: (next: string[]) => void;
  /** Row ceiling: the add button disables once the list reaches it. Mirrors the
   *  server cap of the field being edited. */
  max: number;
  /** Singular name of one entry ("Secondary source"). Names each row and the
   *  add button for screen readers, so the list needs no visible per-row label. */
  itemLabel: string;
  placeholder?: string;
  /** Read-only rendering of an inherited list: locked fields, no add / remove.
   *  Same treatment as `<Input variant="locked">` on a single field. */
  locked?: boolean;
}

export function LinkListInput({
  values,
  onChange,
  max,
  itemLabel,
  placeholder,
  locked = false,
}: LinkListInputProps) {
  const atCap = values.length >= max;
  const lower = itemLabel.toLowerCase();

  return (
    <div className="space-y-2">
      {values.map((url, i) => (
        // Index key: the rows carry no identity of their own (a URL is edited
        // character by character, and the same URL may sit in two rows while
        // typing), and every field is controlled, so a removal re-renders the
        // remaining values into the surviving inputs.
        <div key={i} className="flex items-center gap-2">
          <Input
            variant={locked ? "locked" : "default"}
            type="url"
            readOnly={locked}
            value={url}
            onChange={(e) =>
              onChange(values.map((v, idx) => (idx === i ? e.target.value : v)))
            }
            placeholder={placeholder}
            aria-label={`${itemLabel} ${i + 1}`}
            className="flex-1"
          />
          {!locked && (
            <Button
              variant="ghost"
              icon
              aria-label={`Remove ${lower} ${i + 1}`}
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            >
              <X size={14} />
            </Button>
          )}
        </div>
      ))}

      {!locked && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={atCap}
            onClick={() => onChange([...values, ""])}
          >
            <Plus size={13} strokeWidth={2} />
            Add {lower}
          </Button>
          {atCap && (
            <span className="text-xs text-neutral-500">{max} maximum.</span>
          )}
        </div>
      )}
    </div>
  );
}

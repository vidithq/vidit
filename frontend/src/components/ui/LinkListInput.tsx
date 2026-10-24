"use client";

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "./Button";
import { Input } from "./Input";

// An ordered list of URL fields: one <Input> per row, a remove button on each,
// one add button. It owns the list mechanics (append, edit, remove, the cap, and
// keeping each row's open line aligned with its row). A row is the caller's own
// value; the list reads and writes its URL through `urlOf` / `withUrl`, so
// whatever else a row carries (a post time, an archived copy) moves with it.
//
// Blank rows stay in state while typing; callers drop them from the payload.

/** One row, as the caller's slots see it. */
export interface LinkListRow<R> {
  index: number;
  row: R;
  update: (next: R) => void;
  expanded: boolean;
  toggle: () => void;
}

interface LinkListInputProps<R> {
  rows: R[];
  onChange: (next: R[]) => void;
  urlOf: (row: R) => string;
  withUrl: (row: R, url: string) => R;
  /** The row **Add** appends. */
  blank: () => R;
  /** Row ceiling; mirrors the server cap of the field being edited. */
  max: number;
  /** Singular name of one entry ("Link"), for screen readers. */
  itemLabel: string;
  placeholder?: string;
  invalid?: boolean;
  /** The row's `<Input trailing>`, typically a toggle mark. */
  trailing?: (row: LinkListRow<R>) => ReactNode;
  /** Under the row while it is expanded (`toggle`). */
  expansion?: (row: LinkListRow<R>) => ReactNode;
  /** Under the row, always. */
  detail?: (row: LinkListRow<R>) => ReactNode;
}

export function LinkListInput<R>({
  rows,
  onChange,
  urlOf,
  withUrl,
  blank,
  max,
  itemLabel,
  placeholder,
  invalid = false,
  trailing,
  expansion,
  detail,
}: LinkListInputProps<R>) {
  const atCap = rows.length >= max;
  const lower = itemLabel.toLowerCase();

  // Every row starts closed; the flags move with the rows on a removal.
  const [expanded, setExpanded] = useState<boolean[]>([]);
  const expandedNow = rows.map((_, i) => expanded[i] ?? false);

  const slot = (i: number): LinkListRow<R> => ({
    index: i,
    row: rows[i],
    expanded: expandedNow[i],
    update: (next) => onChange(rows.map((r, idx) => (idx === i ? next : r))),
    toggle: () => setExpanded(expandedNow.map((on, idx) => (idx === i ? !on : on))),
  });

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        // Index key: rows have no identity (a URL is edited per character and may
        // repeat while typing), and every field is controlled.
        <div key={i} className="space-y-1.5">
          {/* Below `sm` the URL takes the whole row and the remove control drops under its
              right end: beside it, a 320px field kept about 9 characters of the URL in view. */}
          <div className="flex max-sm:flex-col max-sm:items-end items-center gap-2">
            {/* `flex-1` sizes this wrapper: an adorned `<Input>` has its own wrapper. */}
            <div className="flex-1 min-w-0 max-sm:self-stretch">
              <Input
                type="url"
                value={urlOf(row)}
                onChange={(e) => slot(i).update(withUrl(row, e.target.value))}
                placeholder={placeholder}
                aria-label={`${itemLabel} ${i + 1}`}
                invalid={invalid && urlOf(row).trim() === ""}
                trailing={trailing?.(slot(i))}
              />
            </div>
            <Button
              variant="ghost"
              icon
              aria-label={`Remove ${lower} ${i + 1}`}
              title={`Remove ${lower} ${i + 1}`}
              onClick={() => {
                onChange(rows.filter((_, idx) => idx !== i));
                setExpanded(expandedNow.filter((_, idx) => idx !== i));
              }}
            >
              <X size={14} />
            </Button>
          </div>
          {detail?.(slot(i))}
          {expandedNow[i] && expansion?.(slot(i))}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={atCap}
          onClick={() => {
            onChange([...rows, blank()]);
            setExpanded([...expandedNow, false]);
          }}
        >
          <Plus size={13} strokeWidth={2} />
          Add {lower}
        </Button>
        {atCap && <span className="text-xs text-neutral-500">{max} maximum.</span>}
      </div>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
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

/** A second value carried by every row, and what renders it under that row.
 *
 *  On the source forms it is the archived copy of each link. The values live
 *  here rather than in the caller because the list mechanics do: an add or a
 *  removal has to move both arrays at once, and only this component knows which
 *  index moved. */
interface LinkListCompanion {
  /** One entry per row, index-aligned with `values`. A caller that starts from
   *  a shorter list reads the missing entries as blank. */
  values: string[];
  onChange: (next: string[]) => void;
  /** What renders under the row: given the link typed above it and the row's
   *  own value. */
  render: (row: {
    index: number;
    url: string;
    value: string;
    onChange: (next: string) => void;
  }) => ReactNode;
}

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
  /** An optional second field per row (see `LinkListCompanion`). */
  companion?: LinkListCompanion;
}

export function LinkListInput({
  values,
  onChange,
  max,
  itemLabel,
  placeholder,
  companion,
}: LinkListInputProps) {
  const atCap = values.length >= max;
  const lower = itemLabel.toLowerCase();
  // Normalised to the row count, so a caller that seeded a shorter list still
  // gets an entry per row and every index below reads a string.
  const companionValues = values.map((_, i) => companion?.values[i] ?? "");

  // Every mutation goes through one call, so the two arrays cannot move apart:
  // a removal that dropped a URL and kept its copy would file that copy against
  // the next mirror down.
  const setRows = (nextValues: string[], nextCompanion: string[]) => {
    onChange(nextValues);
    companion?.onChange(nextCompanion);
  };

  return (
    <div className="space-y-2">
      {values.map((url, i) => (
        // Index key: the rows carry no identity of their own (a URL is edited
        // character by character, and the same URL may sit in two rows while
        // typing), and every field is controlled, so a removal re-renders the
        // remaining values into the surviving inputs.
        <div key={i} className={companion ? "space-y-1.5" : undefined}>
          <div className="flex items-center gap-2">
            <Input
              type="url"
              value={url}
              onChange={(e) =>
                setRows(
                  values.map((v, idx) => (idx === i ? e.target.value : v)),
                  companionValues
                )
              }
              placeholder={placeholder}
              aria-label={`${itemLabel} ${i + 1}`}
              className="flex-1"
            />
            <Button
              variant="ghost"
              icon
              aria-label={`Remove ${lower} ${i + 1}`}
              onClick={() =>
                setRows(
                  values.filter((_, idx) => idx !== i),
                  companionValues.filter((_, idx) => idx !== i)
                )
              }
            >
              <X size={14} />
            </Button>
          </div>
          {companion?.render({
            index: i,
            url,
            value: companionValues[i],
            onChange: (next) =>
              companion.onChange(
                companionValues.map((v, idx) => (idx === i ? next : v))
              ),
          })}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={atCap}
          onClick={() => setRows([...values, ""], [...companionValues, ""])}
        >
          <Plus size={13} strokeWidth={2} />
          Add {lower}
        </Button>
        {atCap && (
          <span className="text-xs text-neutral-500">{max} maximum.</span>
        )}
      </div>
    </div>
  );
}

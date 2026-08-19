"use client";

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "./Button";
import { Input } from "./Input";

// An ordered list of URL fields: one <Input> per entry, a remove affordance on
// each, and one add button under them. Composes the existing <Input> and
// <Button> primitives; the list mechanics (append, edit at index, remove at
// index, the cap, and keeping a companion's values and open lines aligned with
// the rows) are the only thing it owns.
//
// Blank rows are kept in state while the analyst types; callers drop them when
// they assemble their payload, so an untouched row never posts.

/** One row, as the companion sees it. */
interface CompanionRow {
  index: number;
  /** The link typed in the row above. */
  url: string;
  /** The companion's own value for this row. */
  value: string;
  onChange: (next: string) => void;
  /** Whether the row's companion line is showing. */
  expanded: boolean;
  toggle: () => void;
}

/** A second value carried by every row: a mark inside the row's URL field, and
 *  a line under that field while the row is expanded.
 *
 *  On the source forms it is the archived copy of each link. The values live
 *  here rather than in the caller because the list mechanics do: an add or a
 *  removal has to move both arrays at once, and only this component knows which
 *  index moved. The expanded flags move with them for the same reason: a
 *  removal that dropped a URL and kept its open line would open the line of the
 *  next mirror down. */
interface LinkListCompanion {
  /** One entry per row, index-aligned with `values`. A caller that starts from
   *  a shorter list reads the missing entries as blank. */
  values: string[];
  onChange: (next: string[]) => void;
  /** The row's URL field adornment (`<Input trailing>`), typically the mark
   *  that toggles the line below. */
  trailing?: (row: CompanionRow) => ReactNode;
  /** What renders under the row while it is expanded. Called only then, so the
   *  companion states the content and the list states when it shows. */
  render: (row: CompanionRow) => ReactNode;
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

  // A row whose companion already holds a value opens showing it: a seeded
  // value nothing displays is a value the analyst cannot correct. A row added
  // here starts closed, since nothing has been typed in it yet.
  const [expanded, setExpanded] = useState<boolean[]>(() =>
    values.map((_, i) => (companion?.values[i] ?? "") !== "")
  );
  const isExpanded = (i: number) => expanded[i] ?? false;

  // Every mutation goes through one call, so the three arrays cannot move
  // apart: a removal that dropped a URL and kept its copy would file that copy
  // against the next mirror down.
  //
  // The companion is republished only when it actually moved. Typing in a URL
  // field moves that array alone, and handing the caller a fresh companion array
  // on every keystroke would give it a new identity per character, which every
  // memo and effect keyed on it reads as a change.
  const setRows = (
    nextValues: string[],
    nextCompanion: string[],
    nextExpanded: boolean[]
  ) => {
    onChange(nextValues);
    if (
      companion &&
      (nextCompanion.length !== companionValues.length ||
        nextCompanion.some((value, i) => value !== companionValues[i]))
    ) {
      companion.onChange(nextCompanion);
    }
    setExpanded(nextExpanded);
  };
  const expandedNow = values.map((_, i) => isExpanded(i));

  // One description of a row, handed to both companion slots, so the mark in
  // the field and the line under it read the same row.
  const companionRow = (i: number): CompanionRow => ({
    index: i,
    url: values[i],
    value: companionValues[i],
    expanded: isExpanded(i),
    onChange: (next) =>
      companion?.onChange(
        companionValues.map((v, idx) => (idx === i ? next : v))
      ),
    toggle: () =>
      setExpanded(expandedNow.map((on, idx) => (idx === i ? !on : on))),
  });

  return (
    <div className="space-y-2">
      {values.map((url, i) => (
        // Index key: the rows carry no identity of their own (a URL is edited
        // character by character, and the same URL may sit in two rows while
        // typing), and every field is controlled, so a removal re-renders the
        // remaining values into the surviving inputs.
        <div key={i} className={companion ? "space-y-1.5" : undefined}>
          <div className="flex items-center gap-2">
            {/* The row, not the field, is what `flex-1` sizes: an adorned
                `<Input>` renders inside a wrapper of its own, and a width class
                handed to the field would leave that wrapper at its content's
                size. */}
            <div className="flex-1 min-w-0">
              <Input
                type="url"
                value={url}
                onChange={(e) =>
                  setRows(
                    values.map((v, idx) => (idx === i ? e.target.value : v)),
                    companionValues,
                    expandedNow
                  )
                }
                placeholder={placeholder}
                aria-label={`${itemLabel} ${i + 1}`}
                trailing={companion?.trailing?.(companionRow(i))}
              />
            </div>
            <Button
              variant="ghost"
              icon
              aria-label={`Remove ${lower} ${i + 1}`}
              title={`Remove ${lower} ${i + 1}`}
              onClick={() =>
                setRows(
                  values.filter((_, idx) => idx !== i),
                  companionValues.filter((_, idx) => idx !== i),
                  expandedNow.filter((_, idx) => idx !== i)
                )
              }
            >
              <X size={14} />
            </Button>
          </div>
          {isExpanded(i) && companion?.render(companionRow(i))}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={atCap}
          onClick={() =>
            setRows([...values, ""], [...companionValues, ""], [...expandedNow, false])
          }
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

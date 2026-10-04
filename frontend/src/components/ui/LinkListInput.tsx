"use client";

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "./Button";
import { Input } from "./Input";

// An ordered list of URL fields: one <Input> per entry, a remove button on each,
// one add button. It owns the list mechanics (append, edit, remove, the cap, and
// keeping a companion's values and open lines aligned with the rows).
//
// Blank rows stay in state while typing; callers drop them from the payload.

/** One row, as the companion sees it. */
interface CompanionRow {
  index: number;
  url: string;
  value: string;
  onChange: (next: string) => void;
  expanded: boolean;
  toggle: () => void;
}

/** A second value per row: a mark inside the URL field, and a line under it while
 *  expanded (on the source forms, the archived copy of each link).
 *
 *  The values and expanded flags live here because an add or a removal must move
 *  all the arrays at once, and only this component knows which index moved. */
interface LinkListCompanion {
  /** Index-aligned with the row values; missing entries read as blank. */
  values: string[];
  onChange: (next: string[]) => void;
  /** The row's `<Input trailing>`, typically the toggle mark. */
  trailing?: (row: CompanionRow) => ReactNode;
  /** Called only while the row is expanded. */
  render: (row: CompanionRow) => ReactNode;
}

interface LinkListInputProps {
  values: string[];
  onChange: (next: string[]) => void;
  /** Row ceiling; mirrors the server cap of the field being edited. */
  max: number;
  /** Singular name of one entry ("Secondary source"), for screen readers. */
  itemLabel: string;
  placeholder?: string;
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
  const companionValues = values.map((_, i) => companion?.values[i] ?? "");

  // A row with a seeded companion value opens showing it; a new row starts closed.
  const [expanded, setExpanded] = useState<boolean[]>(() =>
    values.map((_, i) => (companion?.values[i] ?? "") !== "")
  );
  const isExpanded = (i: number) => expanded[i] ?? false;

  // Every mutation goes through here so the three arrays cannot move apart. The
  // companion is republished only when it moved: a fresh array per keystroke
  // would retrigger every memo and effect keyed on it.
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
        // Index key: rows have no identity (a URL is edited per character and may
        // repeat while typing), and every field is controlled.
        <div key={i} className={companion ? "space-y-1.5" : undefined}>
          <div className="flex items-center gap-2">
            {/* `flex-1` sizes this wrapper: an adorned `<Input>` has its own wrapper. */}
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

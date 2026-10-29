"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { Combobox } from "./Combobox";
import { Pill } from "./Pill";
import { ToggleRow } from "./ToggleRow";

export interface Option {
  value: string;
  label: string;
}

type Row = { option: Option } | { create: string };

const rowKey = (row: Row) => ("option" in row ? row.option.value : `create:${row.create}`);

/**
 * The one selector over a vocabulary (a kind, a level, a conflict, a tag): a `Combobox` whose list
 * holds the unpicked options whose label holds the typed text, every one of them on focus. A pick
 * empties the field and closes the list, and the picks show under the field as removable accent
 * pills. `single` keeps one pick, which a new pick replaces; `required` keeps it from removal.
 */
export function OptionSearch({
  options,
  selected,
  onChange,
  single = false,
  required = false,
  placeholder,
  creatable,
  suggestions = [],
  includeEnded,
  picks = true,
  invalid = false,
  onQueryChange,
  id,
  "aria-label": ariaLabel,
}: {
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  single?: boolean;
  /** A single pick that a new pick replaces but nothing removes. */
  required?: boolean;
  placeholder: string;
  /** Offers to create the typed name when no option bears it exactly. */
  creatable?: { onCreate: (name: string) => void; maxLength?: number };
  /** One-click neutral pills under the field, as many as fit on two lines. */
  suggestions?: Option[];
  /** A switch under the field that adds the options `isEnded` holds back. */
  includeEnded?: { isEnded: (value: string) => boolean; label: string };
  /** Shows the picks under the field; off where the caller shows them. */
  picks?: boolean;
  invalid?: boolean;
  onQueryChange?: (query: string) => void;
  id?: string;
  "aria-label": string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [ended, setEnded] = useState(false);

  const name = query.trim();
  const needle = name.toLowerCase();
  const labelOf = (value: string) => options.find((o) => o.value === value)?.label ?? value;
  const matches = options.filter(
    (o) =>
      !selected.includes(o.value) &&
      (ended || !includeEnded?.isEnded(o.value)) &&
      o.label.toLowerCase().includes(needle),
  );
  const canCreate = !!creatable && name !== "" && !options.some((o) => o.label === name);
  const rows: Row[] = [
    ...matches.map((option) => ({ option })),
    ...(canCreate ? [{ create: name }] : []),
  ];

  const changeQuery = (next: string) => {
    setQuery(next);
    onQueryChange?.(next);
  };
  const add = (value: string) => onChange(single ? [value] : [...selected, value]);
  const unpicked = suggestions.filter((o) => !selected.includes(o.value));
  const { ref: suggestedRef, cut, height } = useFirstLines<HTMLDivElement>(
    2,
    unpicked.map((o) => o.value).join("\n"),
  );

  return (
    <div className="space-y-2">
      <Combobox
        id={id}
        aria-label={ariaLabel}
        placeholder={placeholder}
        maxLength={creatable?.maxLength}
        invalid={invalid}
        query={query}
        onQueryChange={changeQuery}
        open={open}
        onOpenChange={setOpen}
        options={rows}
        optionKey={rowKey}
        pillOption={(row) => "option" in row}
        renderOption={(row) =>
          "option" in row ? (
            row.option.label
          ) : (
            <>
              <Plus size={14} aria-hidden className="shrink-0 text-neutral-500" />
              <span className="min-w-0 truncate">Create &quot;{row.create}&quot;</span>
            </>
          )
        }
        onPick={(row) => {
          if ("option" in row) add(row.option.value);
          else creatable?.onCreate(row.create);
          changeQuery("");
          setOpen(false);
        }}
        status={rows.length === 0 ? "No match." : null}
      />
      {includeEnded && (
        <ToggleRow
          label={includeEnded.label}
          on={ended}
          onToggle={() => setEnded((on) => !on)}
          className="py-0"
        />
      )}
      {picks && selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((value) =>
            single && required ? (
              <Pill key={value} tone="accent">
                {labelOf(value)}
              </Pill>
            ) : (
              <Pill
                key={value}
                tone="accent"
                title={`Remove ${labelOf(value)}`}
                onRemove={() => onChange(selected.filter((v) => v !== value))}
              >
                {labelOf(value)}
              </Pill>
            ),
          )}
        </div>
      )}
      {unpicked.length > 0 && (
        <div
          ref={suggestedRef}
          role="group"
          aria-label={`Suggested ${ariaLabel.toLowerCase()}`}
          className="flex flex-wrap gap-1.5 overflow-hidden"
          style={{ maxHeight: height }}
        >
          {unpicked.map((o, i) => {
            const past = i >= cut;
            return (
              <Pill
                key={o.value}
                onClick={() => add(o.value)}
                icon={<Plus size={12} aria-hidden />}
                className={past ? "invisible" : undefined}
              >
                <span className="sr-only">Add {o.label}</span>
                <span aria-hidden>{o.label}</span>
              </Pill>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Keeps a wrapping row to its first `lines` lines: measures where its children wrap and returns
 * the index of the first child past those lines (`cut`, the child count when all fit) and the
 * height those lines take. The caller hides the children from `cut` on and caps its height, so
 * the row stays laid out and the measure holds as the width changes.
 */
function useFirstLines<T extends HTMLElement>(lines: number, key: string) {
  const ref = useRef<T>(null);
  const [fit, setFit] = useState<{ cut: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const measure = () => {
      const kids = [...row.children] as HTMLElement[];
      const tops = [...new Set(kids.map((k) => k.offsetTop))].sort((a, b) => a - b);
      const last = tops[lines - 1] ?? Infinity;
      const index = kids.findIndex((k) => k.offsetTop > last);
      const cut = index === -1 ? kids.length : index;
      const height = Math.max(0, ...kids.slice(0, cut).map((k) => k.offsetTop + k.offsetHeight));
      setFit((prev) => (prev?.cut === cut && prev.height === height ? prev : { cut, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [lines, key]);

  return { ref, cut: fit?.cut ?? Infinity, height: fit && fit.height > 0 ? fit.height : undefined };
}

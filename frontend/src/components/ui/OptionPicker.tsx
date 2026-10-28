"use client";

import { useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { ChipBucket } from "./ChipBucket";
import { Input } from "./Input";
import { LoadMoreRow } from "./LoadMoreRow";
import { Pill } from "./Pill";

export interface Option {
  value: string;
  label: string;
}

// Up to this many options show whole as chips; a longer list gets the search field, and shows
// this many unpicked options before Show more.
const SHORT_LIST = 8;

/** The picks of a catalogue field, each a chip that removes it, over the field's search. */
export function PickedPills({
  picked,
  onRemove,
}: {
  picked: { id: string; label: string }[];
  onRemove: (id: string) => void;
}) {
  if (picked.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {picked.map(({ id, label }) => (
        <Pill key={id} tone="accent" onClick={() => onRemove(id)}>
          <span className="sr-only">Remove {label}</span>
          <span aria-hidden>{label}</span>
          <X size={12} aria-hidden />
        </Pill>
      ))}
    </div>
  );
}

/**
 * A multi-select over a fixed list of options. A short list is its options as toggle chips
 * (`<ChipBucket>`). A long one is a search field, the picks as removable accent chips, then the
 * first unpicked options the search matches with one Show more. A pick of a value the list lacks
 * (a crafted URL) still shows, by its value.
 */
export function OptionPicker({
  label,
  options,
  selected,
  onToggle,
}: {
  /** What the options are, for the search field's accessible name ("Tags"). */
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  if (options.length <= SHORT_LIST) {
    return (
      <ChipBucket
        options={options.map((o) => ({ id: o.value, name: o.value, label: o.label }))}
        selected={selected}
        onToggle={onToggle}
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const matches = options.filter(
    (o) => !selected.includes(o.value) && o.label.toLowerCase().includes(needle),
  );
  const shown = all || needle ? matches : matches.slice(0, SHORT_LIST);
  // A pick moves its chip out of the list, so focus returns to the search for the next one.
  const pick = (value: string) => {
    onToggle(value);
    searchRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      <Input
        ref={searchRef}
        type="search"
        icon={<Search size={13} />}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        aria-label={`Search ${label.toLowerCase()}`}
        autoFocus
      />
      <PickedPills
        picked={selected.map((value) => ({
          id: value,
          label: options.find((o) => o.value === value)?.label ?? value,
        }))}
        onRemove={pick}
      />
      {shown.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((o) => (
            <Pill key={o.value} tone="neutral" onClick={() => pick(o.value)}>
              {o.label}
            </Pill>
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-500">No match</p>
      )}
      <LoadMoreRow
        walk={{
          hasMore: shown.length < matches.length,
          loadingMore: false,
          loadMore: () => setAll(true),
          error: null,
        }}
      />
    </div>
  );
}

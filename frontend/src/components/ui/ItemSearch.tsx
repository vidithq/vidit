"use client";

import { useRef, useState } from "react";

import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { Combobox } from "./Combobox";
import { Item, type ItemData } from "./Item";
import { RemoveButton } from "./RemoveButton";

/** Not a fetch per keystroke, but up by the time typing stops. */
export const SEARCH_DEBOUNCE_MS = 250;

/** What a search resolves to: the rows, or the rows with a `note` that shows as a muted line (why
 *  a match is left out, how many more there are). */
export type Found<T> = T[] | { rows: T[]; note: string | null };

type ItemSearchRun<T> = (query: string, signal: AbortSignal) => Promise<Found<T>>;

interface ItemSearchAnswer<T> {
  rows: T[];
  note: string | null;
  loading: boolean;
  failed: boolean;
}

const IDLE = { rows: [], note: null, loading: false, failed: false };

/**
 * Runs `run` for `query` once typing rests, or at once for an empty query, while `enabled`. A
 * newer query aborts the request in flight, and an answer only shows while its query is the
 * current one.
 */
function useItemSearch<T>(
  query: string,
  run: ItemSearchRun<T> | null,
  enabled: boolean,
): ItemSearchAnswer<T> {
  const [answer, setAnswer] = useState<{
    query: string;
    rows: T[] | null;
    note: string | null;
  } | null>(null);
  const active = enabled && run !== null;

  useDebouncedEffect(
    () => {
      if (!active) return;
      const controller = new AbortController();
      run(query, controller.signal).then(
        (found) => {
          if (controller.signal.aborted) return;
          setAnswer(
            Array.isArray(found)
              ? { query, rows: found, note: null }
              : { query, rows: found.rows, note: found.note },
          );
        },
        () => {
          if (!controller.signal.aborted) setAnswer({ query, rows: null, note: null });
        },
      );
      return () => controller.abort();
    },
    [query, active],
    query ? SEARCH_DEBOUNCE_MS : 0,
  );

  if (!active) return IDLE;
  const current = answer?.query === query ? answer : null;
  if (!current) return { ...IDLE, loading: true };
  if (current.rows === null) return { ...IDLE, failed: true };
  return { rows: current.rows, note: current.note, loading: false, failed: false };
}

const FAILED = "The search failed.";

type Source<T> =
  | {
      /** Runs once typing rests and the text holds `minChars` characters. */
      search: ItemSearchRun<T>;
      /** The rows on show while the field is empty. Without it, an empty field lists nothing. */
      browse?: (signal: AbortSignal) => Promise<Found<T>>;
      options?: never;
    }
  | {
      /** A loaded list, filtered by title as the text changes. */
      options: T[];
      search?: never;
      browse?: never;
    };

type ItemSearchProps<T> = Source<T> & {
  toItem: (row: T) => ItemData;
  rowKey: (row: T) => string;
  onPick: (row: T) => void;
  /** Rows left out of the list, such as the ones the caller already holds. */
  hide?: (row: T) => boolean;
  /** Typed characters before the list opens: 1 by default for `search`, 0 for `options`, whose
   *  empty field then lists every row. */
  minChars?: number;
  /** The row a pasted text names (an ID, a link), picked at once. */
  pasteId?: (text: string) => T | null;
  /** Takes the trimmed text when Enter finds no highlighted row. */
  onSubmitText?: (text: string) => void;
  onQueryChange?: (query: string) => void;
  /** A muted line over the rows naming what they are. */
  heading?: string;
  emptyText: string;
  loadingText?: string;
  /** Shown when every row the search found is hidden. */
  hiddenText?: string;
  /** Keeps the text and the list after a pick, for a caller that adds several rows. */
  keepOpen?: boolean;
  /** The pick, shown in place of the field as a compact item that `onClear` removes. Without
   *  it the field empties after each pick and the caller keeps its own list. */
  selected?: T | null;
  onClear?: () => void;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
};

/**
 * The one field that finds an item (an event, a site, a collection, an analyst, an organization):
 * a `Combobox` whose rows are compact `<Item>`s, fed by a debounced `search`, a `browse` for the
 * empty field, or a loaded `options` list.
 */
export function ItemSearch<T>({
  search,
  browse,
  options,
  toItem,
  rowKey,
  onPick,
  hide,
  minChars = options ? 0 : 1,
  pasteId,
  onSubmitText,
  onQueryChange,
  heading,
  emptyText,
  loadingText = "Searching…",
  hiddenText,
  keepOpen = false,
  selected,
  onClear,
  id,
  "aria-label": ariaLabel,
  placeholder,
  autoFocus,
  className,
}: ItemSearchProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(!!autoFocus);

  const q = query.trim();
  const ready = q ? q.length >= minChars : !!browse || (!!options && minChars === 0);
  const run: ItemSearchRun<T> | null = options
    ? null
    : q
      ? search
      : browse
        ? (_query, signal) => browse(signal)
        : null;
  const answer = useItemSearch(q, run, open && ready);

  const needle = q.toLowerCase();
  const rows = options
    ? options.filter((row) => toItem(row).title.toLowerCase().includes(needle))
    : answer.rows;
  const visible = hide ? rows.filter((row) => !hide(row)) : rows;
  const status = answer.loading
    ? loadingText
    : answer.failed
      ? FAILED
      : rows.length === 0
        ? (answer.note ?? emptyText)
        : visible.length === 0
          ? [hiddenText, answer.note].filter(Boolean).join(" ") || null
          : answer.note;

  const changeQuery = (next: string) => {
    setQuery(next);
    onQueryChange?.(next);
  };
  const settle = () => {
    if (keepOpen) return;
    changeQuery("");
    setOpen(false);
  };

  if (selected) {
    const item = toItem(selected);
    return (
      <Item
        variant="compact"
        {...item}
        href={undefined}
        actions={
          <RemoveButton
            label={`Remove ${item.title}`}
            onClick={() => {
              onClear?.();
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          />
        }
      />
    );
  }

  return (
    <Combobox
      inputRef={inputRef}
      id={id}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={className}
      query={query}
      onQueryChange={(next) => {
        const pasted = pasteId?.(next);
        if (pasted) {
          onPick(pasted);
          changeQuery("");
          setOpen(false);
        } else changeQuery(next);
      }}
      open={open && ready}
      onOpenChange={setOpen}
      options={answer.loading ? [] : visible}
      optionKey={rowKey}
      renderOption={(row) => (
        <div className="min-w-0 flex-1">
          <Item variant="compact" {...toItem(row)} href={undefined} />
        </div>
      )}
      onPick={(row) => {
        onPick(row);
        settle();
      }}
      onSubmitText={
        onSubmitText &&
        ((text) => {
          onSubmitText(text);
          settle();
        })
      }
      status={status}
      heading={heading}
    />
  );
}

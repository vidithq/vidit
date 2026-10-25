"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "./Button";
import { cn } from "@/lib/cn";

import { FORM_INVALID_LABEL, LABEL_TEXT } from "./form-styles";
import { Input } from "./Input";

// An ordered list of links, one row each: the URL field, the caller's own fields
// (`columns`), and a remove control at the end (red, since it deletes the row), plus one add button. It owns the
// list mechanics (append, edit, remove, the cap, and keeping each row's open line
// aligned with its row). A row is the caller's own value; the list reads and
// writes its URL through `urlOf` / `withUrl`, so whatever else a row carries (a
// post time, an archived copy) moves with it.
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

/** One field of a row after its URL. */
export interface LinkListColumn<R> {
  /** Above the first row on a wide list; a narrow card shows no headers. */
  header: string;
  /** The grid track on a wide list (`13rem`, `auto`). In a narrow card a fixed
   *  track is the cell's minimum width, capped at the card's, and the cell takes
   *  the room left; an `auto` cell keeps its content's width. */
  width: string;
  cell: (row: LinkListRow<R>) => ReactNode;
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
  /** Character ceiling of one URL; mirrors the server cap of the field being edited. */
  maxLength?: number;
  /** Singular name of one entry ("Link"), for screen readers. */
  itemLabel: string;
  /** The add button's text, `Add <itemLabel>` by default. */
  addText?: string;
  /** The add button's accessible name, when its text leaves out what the list belongs to. It
   *  holds the text. */
  addName?: string;
  placeholder?: string;
  invalid?: boolean;
  /** The list's label: the header of the URL column on a wide list, a label above the
   *  cards on a narrow one. Carries the caller's `FieldHelp`; red while `invalid`. */
  heading?: ReactNode;
  /** After the URL, each under its own header. */
  columns?: LinkListColumn<R>[];
  /** Under the row while it is expanded (`toggle`), across the whole row. */
  expansion?: (row: LinkListRow<R>) => ReactNode;
}

export function LinkListInput<R>({
  rows,
  onChange,
  urlOf,
  withUrl,
  blank,
  max,
  maxLength,
  itemLabel,
  addText,
  addName,
  placeholder,
  invalid = false,
  heading = "Links",
  columns = [],
  expansion,
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

  // One track list for the header and every row: each row is a subgrid of the list, so
  // a column keeps one width down the list whatever its cells hold.
  const tracks = {
    "--link-tracks": ["minmax(0,1fr)", ...columns.map((c) => c.width), "auto"].join(" "),
  } as CSSProperties;

  return (
    <div className="space-y-2">
      {/* The list is its own container: the form column, not the screen, decides whether a
          row fits on one line. Below `@xl` (36rem) each row is a card: the URL and its remove
          control on top, the columns wrapping under it. */}
      <div className="@container">
        <div style={tracks} className="flex flex-col gap-2 @xl:grid @xl:grid-cols-(--link-tracks) @xl:items-center">
          {/* One element for both layouts: the label above the cards, and the URL column's
              header on a wide list, where the other columns' headers join it. */}
          <div className="@xl:col-span-full @xl:grid @xl:grid-cols-subgrid">
            <span className={cn(LABEL_TEXT, invalid && FORM_INVALID_LABEL)}>{heading}</span>
            {rows.length > 0 &&
              columns.map((column) => (
                <span key={column.header} aria-hidden className={cn(LABEL_TEXT, "hidden @xl:block")}>
                  {column.header}
                </span>
              ))}
          </div>
          {rows.map((row, i) => (
            // Index key: rows have no identity (a URL is edited per character and may
            // repeat while typing), and every field is controlled.
            <div
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-neutral-800 p-2 @xl:col-span-full @xl:grid-cols-subgrid @xl:border-0 @xl:p-0"
            >
              <Input
                type="url"
                maxLength={maxLength}
                value={urlOf(row)}
                onChange={(e) => slot(i).update(withUrl(row, e.target.value))}
                placeholder={placeholder}
                aria-label={`${itemLabel} ${i + 1}`}
                invalid={invalid && urlOf(row).trim() === ""}
              />
              {columns.length > 0 && (
                // A card's second line; on a wide list the cells sit in the row's own tracks.
                <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-2 @xl:contents">
                  {columns.map((column) => (
                    <div
                      key={column.header}
                      className="min-w-0"
                      style={column.width === "auto" ? undefined : { flex: `1 0 min(${column.width}, 100%)` }}
                    >
                      {column.cell(slot(i))}
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="dangerGhost"
                icon
                aria-label={`Remove ${lower} ${i + 1}`}
                title={`Remove ${lower} ${i + 1}`}
                className="col-start-2 row-start-1 @xl:col-start-auto @xl:row-start-auto"
                onClick={() => {
                  onChange(rows.filter((_, idx) => idx !== i));
                  setExpanded(expandedNow.filter((_, idx) => idx !== i));
                }}
              >
                <X size={14} />
              </Button>
              {expandedNow[i] && expansion && (
                <div className="col-span-full">{expansion(slot(i))}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={atCap}
          aria-label={addName}
          onClick={() => {
            onChange([...rows, blank()]);
            setExpanded([...expandedNow, false]);
          }}
        >
          <Plus size={13} strokeWidth={2} />
          {addText ?? `Add ${lower}`}
        </Button>
        {atCap && <span className="text-xs text-neutral-500">{max} maximum.</span>}
      </div>
    </div>
  );
}

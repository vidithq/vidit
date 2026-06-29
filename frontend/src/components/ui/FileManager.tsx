"use client";

import type { ReactNode } from "react";
import { Plus, Upload, X } from "lucide-react";

export interface FileManagerItem {
  /** Stable React key. */
  key: string;
  /** The item's visual. In `grid` it fills a uniform thumbnail tile (a media
   *  image); in `stack` it IS the tile (a caller-defined file card). The only
   *  per-type concern. */
  content: ReactNode;
  /** Remove handler; omit for a non-removable item (e.g. a locked grid). */
  onRemove?: () => void;
  removeLabel?: string;
}

interface FileManagerProps {
  items: FileManagerItem[];
  /** Stage picked files. Omit for read-only (no drop zone, no remove). */
  onAddFiles?: (files: File[]) => void;
  /** `accept` for the file input. */
  accept: string;
  /** Allow picking several at once (also keeps the drop zone shown once staged). */
  multiple?: boolean;
  /** Drop-zone label + optional hint line. */
  addLabel: string;
  addHint?: string;
  /** `grid` = uniform thumbnail tiles (media); `stack` = caller-defined file
   *  cards in a column (documents). */
  layout?: "grid" | "stack";
}

/**
 * Generic file-staging UI: the drop zone (click + drag-drop), the hidden input,
 * the remove-button chrome, and the layout. Each file type composes it by
 * passing how one item renders (`items[].content`): the media manager passes
 * thumbnails (grid), the archive import passes a file card (stack). A new file
 * type is a new caller, not a new picker.
 */
export function FileManager({
  items,
  onAddFiles,
  accept,
  multiple = false,
  addLabel,
  addHint,
  layout = "grid",
}: FileManagerProps) {
  const grid = layout === "grid";

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Reset so re-picking the same file still fires onChange.
    e.target.value = "";
    if (files.length > 0) onAddFiles?.(multiple ? files : files.slice(0, 1));
  };

  const removeButton = (onClick: () => void, label: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-neutral-950/80 text-neutral-300 transition-colors hover:bg-neutral-950 hover:text-red-400"
    >
      <X size={13} />
    </button>
  );

  const dropzone = onAddFiles ? (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const dropped = Array.from(e.dataTransfer.files ?? []);
        if (dropped.length > 0) onAddFiles(multiple ? dropped : dropped.slice(0, 1));
      }}
      className={
        // Clickable ⇒ orange (design rule). Background stays neutral so it reads
        // as a drop zone, not a button.
        grid
          ? "flex aspect-video cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-orange-500/40 bg-neutral-950 text-orange-400 transition-colors hover:border-orange-500/60 hover:text-orange-300"
          : "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-orange-500/40 bg-neutral-950 px-4 py-10 text-center text-orange-400 transition-colors hover:border-orange-500/60 hover:text-orange-300"
      }
    >
      {grid ? <Plus size={18} /> : <Upload size={24} strokeWidth={1.8} />}
      <span className={grid ? "text-xs" : "text-sm font-medium"}>{addLabel}</span>
      {addHint && !grid && <span className="text-xs text-neutral-500">{addHint}</span>}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={onInput}
      />
    </label>
  ) : null;

  // The drop zone stays while multiple are allowed; for a single-file picker it
  // gives way to the staged item.
  const showDropzone = !!onAddFiles && (multiple || items.length === 0);

  if (grid) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.key}
            className="relative aspect-video overflow-hidden rounded-md border border-neutral-700 bg-neutral-950"
          >
            {it.content}
            {it.onRemove && removeButton(it.onRemove, it.removeLabel ?? "Remove")}
          </div>
        ))}
        {showDropzone && dropzone}
      </div>
    );
  }

  // Stack: the caller's own item tiles in a column; full-width drop zone.
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.key} className="relative w-fit">
          {it.content}
          {it.onRemove && removeButton(it.onRemove, it.removeLabel ?? "Remove")}
        </div>
      ))}
      {showDropzone && dropzone}
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { Plus, Upload, X } from "lucide-react";

import { ICON_TAP_STEP } from "@/components/ui/Button";
import { GraphicContentGate } from "@/components/ui/GraphicContentGate";
import { MediaOverlay } from "@/components/ui/MediaLightbox";

export interface FileManagerItem {
  key: string;
  /** In `grid` it fills a uniform thumbnail tile; in `stack` it is the tile (a
   *  caller-defined file card). */
  content: ReactNode;
  /** Omit for a non-removable item. */
  onRemove?: () => void;
  removeLabel?: string;
  /** Enlarged rendering shown in a lightbox when the tile is clicked. Omit for
   *  an inert item (the archive import's file card). */
  viewContent?: ReactNode;
  viewLabel?: string;
  /** Extra lightbox controls (a download), beside its close button. */
  viewActions?: ReactNode;
  /** Cover the tile with `GraphicContentGate` (event flagged `is_graphic`). The
   *  gate wraps the view trigger too, so the lightbox is unreachable until the
   *  reader confirms. */
  gated?: boolean;
}

interface FileManagerProps {
  items: FileManagerItem[];
  /** Omit for read-only (no drop zone, no remove). */
  onAddFiles?: (files: File[]) => void;
  accept: string;
  /** Also keeps the drop zone shown once staged. */
  multiple?: boolean;
  addLabel: string;
  addHint?: string;
  /** `grid`: thumbnail tiles (media). `stack`: file cards in a column. */
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

  // Held here so the remove button and the view tile stay sibling elements: the
  // remove button paints on top and never opens the lightbox, with no
  // `stopPropagation`.
  const [viewingKey, setViewingKey] = useState<string | null>(null);
  const viewingItem = items.find((it) => it.key === viewingKey && it.viewContent);

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
      title={label}
      // The 24px circle sits in a tile corner, where a near miss opens the
      // lightbox, hence the phone floor.
      className={`absolute top-1 right-1 flex ${ICON_TAP_STEP} sm:size-6 items-center justify-center rounded-full bg-neutral-950/80 text-neutral-300 transition-colors hover:bg-neutral-950 hover:text-red-400`}
    >
      <X size={13} />
    </button>
  );

  const tileBody = (it: FileManagerItem) => {
    const body = it.viewContent ? (
      <button
        type="button"
        onClick={() => setViewingKey(it.key)}
        aria-label={it.viewLabel ?? "View"}
        className="absolute inset-0 h-full w-full cursor-zoom-in"
      >
        {it.content}
      </button>
    ) : (
      it.content
    );
    // Outside the trigger: the reveal control is a button, and nesting is
    // invalid. Wrapping also lets `inert` drop the trigger from the tab order.
    return it.gated ? (
      <GraphicContentGate variant="compact">{body}</GraphicContentGate>
    ) : (
      body
    );
  };

  const lightbox = viewingItem ? (
    <MediaOverlay
      label={viewingItem.viewLabel ?? "View"}
      actions={viewingItem.viewActions}
      onClose={() => setViewingKey(null)}
    >
      {viewingItem.viewContent}
    </MediaOverlay>
  ) : null;

  const dropzone = onAddFiles ? (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const dropped = Array.from(e.dataTransfer.files ?? []);
        if (dropped.length > 0) onAddFiles(multiple ? dropped : dropped.slice(0, 1));
      }}
      className={
        // Clickable is orange; the neutral background reads as a drop zone.
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

  // A single-file picker gives way to the staged item.
  const showDropzone = !!onAddFiles && (multiple || items.length === 0);

  if (grid) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.key}
            className="relative aspect-video overflow-hidden rounded-md border border-neutral-700 bg-neutral-950"
          >
            {tileBody(it)}
            {it.onRemove && removeButton(it.onRemove, it.removeLabel ?? "Remove")}
          </div>
        ))}
        {showDropzone && dropzone}
        {lightbox}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.key} className="relative w-fit">
          {tileBody(it)}
          {it.onRemove && removeButton(it.onRemove, it.removeLabel ?? "Remove")}
        </div>
      ))}
      {showDropzone && dropzone}
      {lightbox}
    </div>
  );
}

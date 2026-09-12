"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ImageUp, Pencil, Trash2 } from "lucide-react";

import { CollectionCover } from "@/components/collections/CollectionCover";
import { CollectionTitleForm } from "@/components/collections/CollectionTitleForm";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FileManager } from "@/components/ui/FileManager";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ACCENT_SURFACE } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import { ACCEPTED_IMAGE_MIME } from "@/lib/mediaTypes";
import {
  deleteCollection,
  deleteCollectionCover,
  renameCollection,
  uploadCollectionCover,
  type Collection,
} from "@/lib/collections";

/** Ties each trigger to the panel it opens two levels down the tree, which
 *  `aria-controls` needs since the two are not DOM siblings. */
const RENAME_PANEL_ID = "collection-rename-panel";
const COVER_PANEL_ID = "collection-cover-panel";

/**
 * The owner's controls for one collection, in the shape every other surface
 * puts its controls in: the action row for the page header's cluster, and the
 * panels its triggers open, for the body directly under that header
 * (`useEventActions` is the same split for an event).
 *
 * Three verbs, all the owner's, none of them a version of anything: the title,
 * the cover, and dropping the collection. Only the last is destructive, so only
 * the last is red, behind the two-click confirm every destructive control on
 * the site takes. The events a dropped collection held are untouched, which is
 * what the confirm's own label says.
 *
 * A visitor is handed nothing: both nodes come back null, so the page renders
 * no empty cluster and no empty slot.
 */
export function useCollectionActions({
  collection,
  isOwner,
  onChanged,
  onDeleted,
}: {
  collection: Collection | null;
  isOwner: boolean;
  /** Runs after a write that changes the header (a rename, a cover), so the
   *  page re-reads it: the response carries the new row, but the count, the
   *  range and the item list are read elsewhere. */
  onChanged: () => void;
  /** Runs once the collection is gone. */
  onDeleted: () => void;
}): { actions: ReactNode; panels: ReactNode } {
  const [renaming, setRenaming] = useState(false);
  const [changingCover, setChangingCover] = useState(false);

  const rename = useMutation(
    (title: string) => renameCollection(collection?.id ?? "", title),
    {
      fallback: "Failed to rename the collection",
      onSuccess: () => {
        setRenaming(false);
        onChanged();
      },
    },
  );

  const setCover = useMutation(
    (file: File) => uploadCollectionCover(collection?.id ?? "", file),
    {
      fallback: "Failed to upload the cover",
      onSuccess: () => {
        setChangingCover(false);
        onChanged();
      },
    },
  );

  const clearCover = useMutation(
    () => deleteCollectionCover(collection?.id ?? ""),
    {
      fallback: "Failed to remove the cover",
      onSuccess: () => {
        setChangingCover(false);
        onChanged();
      },
    },
  );

  const drop = useMutation(() => deleteCollection(collection?.id ?? ""), {
    fallback: "Failed to drop the collection",
    onSuccess: onDeleted,
  });

  // Two clicks, disarming on its own after a few seconds and on any click or
  // focus landing elsewhere: the same confirm every destructive control here
  // takes.
  const {
    armed: dropArmed,
    trigger: triggerDrop,
    controlRef: dropButtonRef,
  } = useConfirmAction(() => void drop.run(), {
    timeoutMs: 4000,
    dismissOnOutside: true,
  });

  // The panels belong to the collection on screen, and this hook survives a
  // client navigation from one collection to the next.
  useEffect(() => {
    setRenaming(false);
    setChangingCover(false);
  }, [collection?.id]);

  if (!collection || !isOwner) return { actions: null, panels: null };

  // The tile shows whatever the collection is wearing, the owner's upload or
  // the first item's own media. `cover_is_uploaded` separates the two, which
  // `cover_url` alone cannot, and only an upload can be removed: offering the
  // control against a fallback names a picture the owner never chose.
  const hasCover = collection.cover_url !== null;
  const hasUpload = collection.cover_is_uploaded;

  // The name says what survives the act, since that is the part a reader
  // hesitates over: the events stay exactly as they are.
  const dropLabel = dropArmed
    ? "Confirm dropping this collection"
    : "Drop this collection (the events it holds stay)";

  return {
    actions: (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button
          icon
          variant="ghost"
          onClick={() => setRenaming((open) => !open)}
          aria-controls={RENAME_PANEL_ID}
          aria-expanded={renaming}
          aria-label="Rename this collection"
          title="Rename this collection"
          className={renaming ? ACCENT_SURFACE : ""}
        >
          <Pencil size={14} />
        </Button>
        <Button
          icon
          variant="ghost"
          onClick={() => setChangingCover((open) => !open)}
          aria-controls={COVER_PANEL_ID}
          aria-expanded={changingCover}
          aria-label="Change the cover"
          title="Change the cover"
          className={changingCover ? ACCENT_SURFACE : ""}
        >
          <ImageUp size={14} />
        </Button>
        <Button
          icon
          ref={dropButtonRef}
          variant={dropArmed ? "danger" : "dangerGhost"}
          disabled={drop.loading}
          onClick={triggerDrop}
          // The name says what survives the act, since that is the part a
          // reader hesitates over: the events stay exactly as they are.
          aria-label={dropLabel}
          title={dropLabel}
          className={dropArmed ? DANGER_CONFIRM : ""}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    ),
    panels: (
      <>
        {renaming && (
          <div id={RENAME_PANEL_ID}>
            <Card as="section">
              <SectionEyebrow title="Rename this collection" margin="none" />
              <CollectionTitleForm
                initialTitle={collection.title}
                submitLabel="Save title"
                busy={rename.loading}
                error={rename.error}
                onSubmit={(title) => void rename.run(title)}
                onCancel={() => setRenaming(false)}
              />
            </Card>
          </div>
        )}
        {changingCover && (
          <div id={COVER_PANEL_ID}>
            <Card as="section">
              <SectionEyebrow title="Cover" margin="none" />
              {/* The profile picture's own picker, the shared `FileManager` in
                  single-file image mode, under the same file rules: its drop
                  zone comes back once nothing is staged, so picking and
                  clearing are one primitive rather than two controls. */}
              <div className="max-w-sm space-y-4">
                <FileManager
                  items={
                    hasCover
                      ? [
                          {
                            key: collection.cover_url ?? "cover",
                            content: (
                              <CollectionCover
                                coverUrl={collection.cover_url}
                              />
                            ),
                          },
                        ]
                      : []
                  }
                  onAddFiles={(files) => {
                    const file = files[0];
                    if (file) void setCover.run(file);
                  }}
                  accept={ACCEPTED_IMAGE_MIME}
                  addLabel={
                    setCover.loading ? "Uploading…" : "Add a cover picture"
                  }
                  addHint="JPEG, PNG or WebP. Stored on Vidit and resized."
                  layout="stack"
                />
                {/* Removing the upload is its own act rather than the tile's
                    clear control: with no upload the cover falls back to the
                    first item's media, so there is always something shown and
                    the tile is never the empty state a clear would produce. */}
                {hasUpload && (
                  <Button
                    variant="ghost"
                    disabled={clearCover.loading}
                    onClick={() => void clearCover.run()}
                  >
                    {clearCover.loading
                      ? "Removing…"
                      : "Remove the uploaded picture"}
                  </Button>
                )}
                <p className="text-xs text-neutral-500">
                  With no picture uploaded, the cover is the first item&apos;s
                  own media.
                </p>
              </div>
              {(setCover.error || clearCover.error) && (
                <div className={FORM_ERROR_BANNER}>
                  {setCover.error ?? clearCover.error}
                </div>
              )}
            </Card>
          </div>
        )}
        {drop.error && <div className={FORM_ERROR_BANNER}>{drop.error}</div>}
      </>
    ),
  };
}

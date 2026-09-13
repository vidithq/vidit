"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { CollectionDetailsForm } from "@/components/collections/CollectionDetailsForm";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ACCENT_SURFACE } from "@/components/ui/styles";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useMutation } from "@/hooks/useMutation";
import {
  deleteCollection,
  updateCollection,
  type Collection,
} from "@/lib/collections";

/** Ties the trigger to the panel it opens two levels down the tree, which
 *  `aria-controls` needs since the two are not DOM siblings. */
const DETAILS_PANEL_ID = "collection-details-panel";

/**
 * The owner's controls for one collection, in the shape every other surface
 * puts its controls in: the action row for the page header's cluster, and the
 * panels its triggers open, for the body directly under that header
 * (`useEventActions` is the same split for an event).
 *
 * Two verbs, both the owner's, neither of them a version of anything: the
 * details the collection states about itself (its title and its description,
 * written together), and dropping the collection. There is no picture to set:
 * the card's mosaic is read off the items themselves. Only the second verb is
 * destructive, so only it is red, behind the two-click confirm every
 * destructive control on the site takes. The events a dropped collection held
 * are untouched, which is what the confirm's own label says.
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
  /** Runs after a write that changes the header (an edit of the details), so
   *  the page re-reads it: the response carries the new row, but the count,
   *  the range and the item list are read elsewhere. */
  onChanged: () => void;
  /** Runs once the collection is gone. */
  onDeleted: () => void;
}): { actions: ReactNode; panels: ReactNode } {
  const [editing, setEditing] = useState(false);

  const save = useMutation(
    (title: string, description: string) =>
      updateCollection(collection?.id ?? "", title, description),
    {
      fallback: "Failed to save the collection's details",
      onSuccess: () => {
        setEditing(false);
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

  // The panel belongs to the collection on screen, and this hook survives a
  // client navigation from one collection to the next.
  useEffect(() => {
    setEditing(false);
  }, [collection?.id]);

  if (!collection || !isOwner) return { actions: null, panels: null };

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
          onClick={() => setEditing((open) => !open)}
          aria-controls={DETAILS_PANEL_ID}
          aria-expanded={editing}
          aria-label="Edit this collection's details"
          title="Edit this collection's details"
          className={editing ? ACCENT_SURFACE : ""}
        >
          <Pencil size={14} />
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
        {editing && (
          <div id={DETAILS_PANEL_ID}>
            <Card as="section">
              <SectionEyebrow title="Edit details" margin="none" />
              <CollectionDetailsForm
                initialTitle={collection.title}
                initialDescription={collection.description}
                submitLabel="Save details"
                busy={save.loading}
                error={save.error}
                onSubmit={(title, description) =>
                  void save.run(title, description)
                }
                onCancel={() => setEditing(false)}
              />
            </Card>
          </div>
        )}
        {drop.error && <div className={FORM_ERROR_BANNER}>{drop.error}</div>}
      </>
    ),
  };
}

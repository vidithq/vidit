"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";

import { SourceEditor, type SourceEditorInvalid } from "@/components/sources/SourceEditor";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { HorizontalScroller, type HorizontalScrollerHandle } from "@/components/ui/HorizontalScroller";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { isSnapshotUrl, SNAPSHOT_HINT } from "@/components/ui/ArchivedCopies";
import { MAX_SOURCES_PER_EVENT, type MissingFieldKey } from "@/lib/events";
import {
  draftUrls,
  newSourceDraft,
  uploadError,
  uploadsRunning,
  uploadSourceFile,
  UPLOADS_RUNNING_MESSAGE,
  type SourceDraft,
  type SourceFile,
} from "@/lib/sources";
import type { Tag } from "@/types";

let uploadToken = 0;

/**
 * The **Sources** section every event form carries: a `HorizontalScroller` row of one
 * `SourceEditor` per source, side by side like the event page's, **Add a source** in its header
 * (capped at `MAX_SOURCES_PER_EVENT`), and per editor a two-click remove. Every editor stays
 * mounted, so one scrolled out of view keeps its upload.
 *
 * A picked file uploads at once, on its own request; the editor keeps the staged upload, and the
 * event write names it. A file picked again or removed while its upload runs drops the answer.
 */
export function SourcesField({
  sources,
  setSources,
  tags,
  setTags,
  invalidKeys,
  attempt = 0,
}: {
  sources: SourceDraft[];
  setSources: Dispatch<SetStateAction<SourceDraft[]>>;
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  /** The keys a publish attempt flagged (`useIncompleteForm`). */
  invalidKeys: ReadonlySet<MissingFieldKey>;
  /** `useIncompleteForm`'s attempt count: each new one shows the first source with a gap. */
  attempt?: number;
}) {
  const atCap = sources.length >= MAX_SOURCES_PER_EVENT;

  const update = (key: string) => (patch: Partial<SourceDraft>) =>
    setSources((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const settle = (key: string, token: number, file: SourceFile) =>
    setSources((prev) =>
      prev.map((d) =>
        d.key === key && d.file?.state === "uploading" && d.file.token === token
          ? { ...d, file }
          : d
      )
    );

  const pickFile = (key: string) => async (file: File) => {
    const token = ++uploadToken;
    update(key)({ file: { state: "uploading", file, token } });
    try {
      settle(key, token, { state: "staged", upload: await uploadSourceFile(file) });
    } catch (err) {
      settle(key, token, { state: "failed", file, error: uploadError(err) });
    }
  };

  const scroller = useRef<HorizontalScrollerHandle>(null);
  // A source to show once the list renders: the one Add a source appended, the neighbour of a
  // removed one. A publish attempt that flags a source shows the first one with a gap instead.
  const reveal = useRef<string | null>(null);
  const handledAttempt = useRef(attempt);
  useEffect(() => {
    let key = reveal.current;
    reveal.current = null;
    if (handledAttempt.current !== attempt) {
      handledAttempt.current = attempt;
      key = firstGap(sources, invalidKeys) ?? key;
    }
    const index = key === null ? -1 : sources.findIndex((d) => d.key === key);
    if (index >= 0) scroller.current?.show(index);
  });

  const add = () => {
    const draft = newSourceDraft();
    reveal.current = draft.key;
    setSources((prev) => [...prev, draft]);
  };

  const remove = (index: number) => {
    reveal.current = (sources[index + 1] ?? sources[index - 1])?.key ?? null;
    setSources((prev) => prev.filter((d) => d.key !== sources[index].key));
  };

  const fileMissing = invalidKeys.has("source_file");

  return (
    // No card of its own: the heading row sits on the page like the event page's Sources
    // eyebrow, and each editor is the card.
    <section>
      <HorizontalScroller
        ref={scroller}
        heading={
          <div className="space-y-1">
            <SectionEyebrow margin="none" title="Sources" concept="sources" invalid={fileMissing} />
            {fileMissing && (
              <p className="text-xs text-red-400">Add a file to a direct or indirect source.</p>
            )}
          </div>
        }
        label="Sources"
        previousLabel="Previous source"
        nextLabel="Next source"
        actions={
          <>
            {atCap && (
              <span className="text-xs text-neutral-500">{MAX_SOURCES_PER_EVENT} maximum.</span>
            )}
            <Button variant="secondary" disabled={atCap} onClick={add}>
              <Plus size={13} strokeWidth={2} />
              Add a source
            </Button>
          </>
        }
      >
        {sources.map((draft, index) => (
          <SourceEditor
            key={draft.key}
            draft={draft}
            index={index}
            update={update(draft.key)}
            onPickFile={(file) => void pickFile(draft.key)(file)}
            tags={tags}
            setTags={setTags}
            invalid={sourceGaps(draft, invalidKeys)}
            actions={sources.length > 1 && <RemoveSource index={index} onRemove={() => remove(index)} />}
          />
        ))}
      </HorizontalScroller>
    </section>
  );
}

/** An editor's red trash button: the first click arms it, the second removes the source. */
function RemoveSource({ index, onRemove }: { index: number; onRemove: () => void }) {
  const { armed, trigger, controlRef } = useConfirmAction(onRemove, {
    timeoutMs: ARM_MS,
    dismissOnOutside: true,
  });
  const label = armed ? `Confirm removing source ${index + 1}` : `Remove source ${index + 1}`;
  return (
    <Button
      ref={controlRef}
      icon
      variant="dangerGhost"
      className={armed ? DANGER_CONFIRM : ""}
      onClick={trigger}
      aria-label={label}
    >
      <Trash2 size={14} />
    </Button>
  );
}

/** The fields of one editor a publish attempt flagged. */
function sourceGaps(draft: SourceDraft, invalidKeys: ReadonlySet<MissingFieldKey>): SourceEditorInvalid {
  return {
    link: invalidKeys.has("source_link") && draftUrls(draft).length === 0,
    kind: invalidKeys.has("source_kind") && draft.kind === "",
  };
}

/** The first editor a publish attempt flagged: a missing link or kind, else the first direct or
 *  indirect source when none carries a file. */
function firstGap(drafts: SourceDraft[], invalidKeys: ReadonlySet<MissingFieldKey>): string | null {
  const gap =
    drafts.find((d) => {
      const { link, kind } = sourceGaps(d, invalidKeys);
      return link || kind;
    }) ?? (invalidKeys.has("source_file") ? drafts.find((d) => d.level !== "context") : undefined);
  return gap?.key ?? null;
}

/** Whether a pasted archived copy cannot be one (`isSnapshotUrl`): the form refuses it before
 *  the write, with `SNAPSHOT_HINT`. A copy is optional, so a blank one passes. */
export function pastedSnapshotRefused(drafts: SourceDraft[]): boolean {
  return drafts.some((d) =>
    d.links.some((l) => l.snapshotUrl.trim() !== "" && !isSnapshotUrl(l.snapshotUrl))
  );
}

/** The check every event form runs before its write, past the floor: a running upload or a
 *  refused archived copy. Null when the write may go. */
export function sourcesBlockWrite(drafts: SourceDraft[]): string | null {
  if (uploadsRunning(drafts)) return UPLOADS_RUNNING_MESSAGE;
  if (pastedSnapshotRefused(drafts)) return SNAPSHOT_HINT;
  return null;
}

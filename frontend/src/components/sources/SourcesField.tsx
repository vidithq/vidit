"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { Plus } from "lucide-react";

import { SourceEditor, type SourceEditorInvalid } from "@/components/sources/SourceEditor";
import { SourcesRow } from "@/components/sources/SourcesRow";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { RemoveButton } from "@/components/ui/RemoveButton";
import type { HorizontalScrollerHandle } from "@/components/ui/HorizontalScroller";
import { ARM_MS, useConfirmAction } from "@/hooks/useConfirmAction";
import { isSnapshotUrl, SNAPSHOT_HINT } from "@/components/ui/ArchivedCopies";
import type { MissingFieldKey } from "@/lib/events";
import {
  draftUrls,
  fileRunning,
  importSourceFile,
  isEvidenceLevel,
  MAX_SOURCES_PER_EVENT,
  newSourceDraft,
  sourceName,
  uploadError,
  uploadsRunning,
  uploadSourceFile,
  UPLOADS_RUNNING_MESSAGE,
  type LinkPost,
  type SourceDraft,
  type SourceFile,
} from "@/lib/sources";
import { safeHostname } from "@/lib/format";
import type { Tag } from "@/types";

let uploadToken = 0;

/**
 * The **Sources** section every event form carries: the event page's `SourcesRow`, one
 * `SourceEditor` per source (a lone one `wide`, its file beside its fields), **Add a source** in
 * its header
 * (capped at `MAX_SOURCES_PER_EVENT`), and per editor a two-click remove. Every editor stays
 * mounted, so one scrolled out of view keeps its upload.
 *
 * A picked file uploads at once, on its own request; the editor keeps the staged upload, and the
 * event write names it. A file imported from a link stages the same way, through the link's post.
 * A file picked, imported or removed while an upload runs drops that upload's answer.
 */
export function SourcesField({
  sources,
  setSources,
  tags,
  setTags,
  suggestedTags,
  invalidKeys,
  attempt = 0,
}: {
  sources: SourceDraft[];
  setSources: Dispatch<SetStateAction<SourceDraft[]>>;
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  suggestedTags?: Tag[];
  /** The keys a publish attempt flagged (`useIncompleteForm`). */
  invalidKeys: ReadonlySet<MissingFieldKey>;
  /** `useIncompleteForm`'s attempt count: each new one shows the first source with a gap. */
  attempt?: number;
}) {
  const atCap = sources.length >= MAX_SOURCES_PER_EVENT;

  const { update, pickFile, importLink } = sourceDraftUpdaters(setSources);

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
    <SourcesRow
      ref={scroller}
      count={sources.length}
      invalid={fileMissing}
      note={
        fileMissing && (
          <p className="text-xs text-red-400">Add a file to a direct or indirect source.</p>
        )
      }
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
          onImportLink={(post) => void importLink(draft.key)(post)}
          tags={tags}
          setTags={setTags}
          suggestedTags={suggestedTags}
          invalid={sourceGaps(draft, invalidKeys)}
          actions={sources.length > 1 && <RemoveSource index={index} onRemove={() => remove(index)} />}
          wide={sources.length === 1}
        />
      ))}
    </SourcesRow>
  );
}

/**
 * The writers a form's source editors take: `update(key)` patches one draft, `pickFile(key)`
 * uploads a picked file at once, on its own request, and `importLink(key)` stages the file of a
 * link's post the same way. The answer lands on the draft only while that same request is still
 * its file, so a file picked, imported or removed while a request runs drops the answer.
 */
export function sourceDraftUpdaters(setSources: Dispatch<SetStateAction<SourceDraft[]>>) {
  const update = (key: string) => (patch: Partial<SourceDraft>) =>
    setSources((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const settle = (key: string, token: number, file: SourceFile) =>
    setSources((prev) =>
      prev.map((d) =>
        d.key === key && fileRunning(d.file) && d.file.token === token
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
      settle(key, token, { state: "failed", name: file.name, error: uploadError(err) });
    }
  };

  const importLink = (key: string) => async (post: LinkPost) => {
    const token = ++uploadToken;
    update(key)({ file: { state: "importing", post, token } });
    try {
      const { post_media: kinds, ...upload } = await importSourceFile(post.url, post.index);
      settle(key, token, { state: "staged", upload, post: { ...post, kinds } });
    } catch (err) {
      settle(key, token, { state: "failed", name: safeHostname(post.url), error: uploadError(err) });
    }
  };

  return { update, pickFile, importLink };
}

/** An editor's red trash button: the first click arms it, the second removes the source. */
function RemoveSource({ index, onRemove }: { index: number; onRemove: () => void }) {
  const { armed, trigger, controlRef } = useConfirmAction(onRemove, {
    timeoutMs: ARM_MS,
    dismissOnOutside: true,
  });
  const name = sourceName(index).toLowerCase();
  const label = armed ? `Confirm removing ${name}` : `Remove ${name}`;
  return (
    <RemoveButton
      ref={controlRef}
      confirms
      label={label}
      className={armed ? DANGER_CONFIRM : ""}
      onClick={trigger}
    />
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
    }) ?? (invalidKeys.has("source_file") ? drafts.find((d) => isEvidenceLevel(d.level)) : undefined);
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

"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X } from "lucide-react";

import { SourceEditor } from "@/components/sources/SourceEditor";
import { SourcePicker } from "@/components/sources/SourcePicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MergeAction } from "@/components/ui/MergeAction";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { isSnapshotUrl, SNAPSHOT_HINT } from "@/components/ui/ArchivedCopies";
import { WARNING_CALLOUT } from "@/components/ui/styles";
import { MAX_LINKS_PER_SOURCE, MAX_SOURCES_PER_EVENT, type MissingFieldKey } from "@/lib/events";
import {
  draftUrls,
  mergeSourceDrafts,
  newSourceDraft,
  sourceDraftFromPick,
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
 * The **Sources** section every event form carries: one `SourceEditor` per source, **Add a
 * source** (capped at `MAX_SOURCES_PER_EVENT`), **Copy an existing source** through the picker,
 * and per editor **Merge** (into another editor of the list) and **Remove**.
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
}: {
  sources: SourceDraft[];
  setSources: Dispatch<SetStateAction<SourceDraft[]>>;
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  /** The keys a publish attempt flagged (`useIncompleteForm`). */
  invalidKeys: ReadonlySet<MissingFieldKey>;
}) {
  const [picking, setPicking] = useState(false);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const atCap = sources.length >= MAX_SOURCES_PER_EVENT;
  const label = (i: number) => `Source ${i + 1}`;

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

  const merge = (dropKey: string, keepKey: string) => {
    const drop = sources.find((d) => d.key === dropKey);
    const keep = sources.find((d) => d.key === keepKey);
    if (!drop || !keep) return;
    const { merged, overflow } = mergeSourceDrafts(keep, drop);
    setSources((prev) =>
      prev.filter((d) => d.key !== dropKey).map((d) => (d.key === keepKey ? merged : d))
    );
    setMergeNotice(
      overflow > 0
        ? `${overflow} of its links did not fit: a source holds at most ${MAX_LINKS_PER_SOURCE} URLs.`
        : null
    );
  };

  const fileMissing = invalidKeys.has("source_file");

  return (
    <Card as="section">
      <SectionHeading title="Sources" concept="sources" invalid={fileMissing} />
      {fileMissing && (
        <p className="text-xs text-red-400">Add a file to a direct or indirect source.</p>
      )}
      {mergeNotice && (
        <p className={`rounded-md px-2 py-1 text-xs ${WARNING_CALLOUT}`} role="status">
          {mergeNotice}
        </p>
      )}

      {sources.map((draft, index) => (
        <SourceEditor
          key={draft.key}
          draft={draft}
          index={index}
          update={update(draft.key)}
          onPickFile={(file) => void pickFile(draft.key)(file)}
          tags={tags}
          setTags={setTags}
          invalid={{
            link: invalidKeys.has("source_link") && draftUrls(draft).length === 0,
            kind: invalidKeys.has("source_kind") && draft.kind === "",
          }}
          actions={
            sources.length > 1 && (
              <>
                <MergeAction
                  subject={label(index)}
                  targets={sources.flatMap((d, i) =>
                    d.key === draft.key ? [] : [{ key: d.key, label: label(i) }]
                  )}
                  onMerge={(keepKey) => merge(draft.key, keepKey)}
                />
                <Button
                  variant="ghost"
                  onClick={() => setSources((prev) => prev.filter((d) => d.key !== draft.key))}
                  aria-label={`Remove ${label(index).toLowerCase()}`}
                >
                  <X size={13} />
                  Remove
                </Button>
              </>
            )
          }
        />
      ))}

      {picking && (
        <SourcePicker
          disabled={atCap}
          onClose={() => setPicking(false)}
          onPick={(pick) => {
            setSources((prev) => [...prev, sourceDraftFromPick(pick)]);
            setPicking(false);
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={atCap}
          onClick={() => setSources((prev) => [...prev, newSourceDraft()])}
        >
          <Plus size={13} strokeWidth={2} />
          Add a source
        </Button>
        {!picking && (
          <Button variant="ghost" disabled={atCap} onClick={() => setPicking(true)}>
            Copy an existing source
          </Button>
        )}
        {atCap && (
          <span className="text-xs text-neutral-500">{MAX_SOURCES_PER_EVENT} maximum.</span>
        )}
      </div>
    </Card>
  );
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

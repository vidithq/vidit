"use client";

import { useState, type SetStateAction } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ConflictTypeahead } from "@/components/ui/TagPicker";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  FORM_SUCCESS_BANNER,
  LABEL_TEXT,
} from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { useMutation } from "@/hooks/useMutation";
import {
  batchCompleteDrafts,
  batchCompletionBlockers,
  type BatchCompletionResult,
} from "@/lib/events";
import type { Conflict, EventDetail, Tag } from "@/types";

/** The empty option's value: this row is not part of the publish. */
const NOT_NOW = "";

/** The apply-to-all's reset option. A value of its own, not `NOT_NOW`: the
 *  control is pinned to the placeholder, so a clear branch keyed on the
 *  placeholder's value could never fire (re-selecting it is not a change). */
const CLEAR_ALL = "__clear__";

type RowVerdict = BatchCompletionResult["rows"][number];

/**
 * Batch completion on the Detections queue: publish a selection of imported
 * drafts in one pass.
 *
 * The economics the panel exists for: an import already filled title,
 * coordinates, source and proof, so all that stands between a draft and a
 * published geolocation is judgment the machine can't supply. That judgment is
 * split by how it varies. The **conflict** is set once for the whole selection
 * (an import is usually dominated by one), the **capture source** is one
 * dropdown per row (drone / ground / satellite vary draft to draft), with an
 * apply-to-all for the imports where they don't.
 *
 * A row's capture source IS its selection: pick one and the draft joins the
 * publish, leave it on "Not now" and it stays a draft. There is no separate
 * checkbox, because a row can't publish without the pick anyway.
 *
 * Rows the batch can't finish (no proof image, no source media, no
 * coordinates, no source) are surfaced up front and locked out of the
 * selection: they need a manual pass on the submit form, and the panel says so
 * rather than letting the analyst discover it at publish. The server re-runs
 * the same floor per row regardless, and a row it rejects keeps its reason
 * here.
 */
export function BatchCompletionPanel({
  drafts,
  curatedTags,
  conflicts,
  onPublished,
}: {
  /** The drafts on the current page of the queue. */
  drafts: EventDetail[];
  /** The curated taxonomy (`?curated=true`); the panel reads its
   *  `capture_source` rows. */
  curatedTags: Tag[];
  /** The conflicts referential, filtered client-side by the typeahead. */
  conflicts: Conflict[];
  /** Refresh the queue: the published rows leave it. */
  onPublished: () => void;
}) {
  const [selectedConflictIds, setSelectedConflictIds] = useState<string[]>([]);
  // eventId -> capture-source tag id. Absent / `NOT_NOW` means "leave it a
  // draft"; the queue opens with nothing selected, so publishing is always a
  // deliberate act.
  const [picks, setPicks] = useState<Record<string, string>>({});
  // Per-row verdicts keyed by id, accumulated across runs: the published rows
  // leave the refreshed queue, and every rejected one keeps its reason attached
  // until a later run gives that same row a new one.
  const [verdicts, setVerdicts] = useState<Record<string, RowVerdict>>({});
  // The headline counts of the last run, and only while they still describe
  // what is on screen: any change to the selection drops the banner.
  const [summary, setSummary] = useState<BatchCompletionResult | null>(null);

  const captureSources = curatedTags.filter((t) => t.category === "capture_source");

  // A row's blockers, computed once per render: they gate the dropdown and
  // caption the row.
  const blockersById = new Map(drafts.map((d) => [d.id, batchCompletionBlockers(d)]));
  const eligible = drafts.filter((d) => (blockersById.get(d.id) ?? []).length === 0);
  const selected = eligible.filter((d) => (picks[d.id] ?? NOT_NOW) !== NOT_NOW);

  const publish = useMutation(
    () =>
      batchCompleteDrafts({
        conflict_ids: selectedConflictIds,
        rows: selected.map((d) => ({
          event_id: d.id,
          capture_source_tag_id: picks[d.id],
        })),
      }),
    {
      fallback: "Could not publish the selection.",
      onSuccess: (result) => {
        setSummary(result);
        // Merged, not replaced: a row rejected by run 1 and left out of run 2
        // keeps the explanation it was given. Each run overwrites only the
        // rows it actually carried.
        setVerdicts((prev) => ({
          ...prev,
          ...Object.fromEntries(result.rows.map((row) => [row.event_id, row])),
        }));
        // Drop the picks of everything that published so a second run can't
        // re-post them; a rejected row keeps its pick, ready for a retry.
        setPicks((prev) => {
          const next = { ...prev };
          for (const row of result.rows) if (row.published) delete next[row.event_id];
          return next;
        });
        onPublished();
      },
    }
  );

  // The summary counts one run of one selection, so it stops being true the
  // moment the selection moves. Both mutators of the selection clear it.
  const changePicks = (next: SetStateAction<Record<string, string>>) => {
    setSummary(null);
    setPicks(next);
  };
  const changeConflicts = (next: SetStateAction<string[]>) => {
    setSummary(null);
    setSelectedConflictIds(next);
  };

  const applyToAll = (value: string) => {
    if (value === CLEAR_ALL) {
      changePicks({});
      return;
    }
    changePicks(Object.fromEntries(eligible.map((d) => [d.id, value])));
  };

  const ready = selectedConflictIds.length > 0 && selected.length > 0;

  if (captureSources.length === 0 || conflicts.length === 0) {
    // The taxonomy hasn't loaded (or failed): the queue's cards below still
    // work, and this panel has nothing to offer without it.
    return null;
  }

  return (
    <Card as="section">
      <SectionHeading title="Complete and publish" concept="section_batch_completion" />

      <div className="space-y-2">
        <span className={FORM_LABEL}>
          Conflict, for the whole selection <FieldHelp concept="conflict" />
        </span>
        <ConflictTypeahead
          conflicts={conflicts}
          selectedIds={selectedConflictIds}
          setSelectedIds={changeConflicts}
        />
      </div>

      <div className="space-y-2">
        <label className={FORM_LABEL} htmlFor="batch-apply-all">
          Capture source for every row <FieldHelp concept="capture_source" />
        </label>
        <Select
          id="batch-apply-all"
          value={NOT_NOW}
          onChange={(e) => applyToAll(e.target.value)}
          className="max-w-xs"
        >
          <option value={NOT_NOW}>Apply to all…</option>
          {captureSources.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
          <option value={CLEAR_ALL}>Clear every row</option>
        </Select>
      </div>

      <div className="space-y-2">
        <div className={`grid grid-cols-[1fr_11rem] gap-3 ${LABEL_TEXT}`}>
          <span>Draft</span>
          <span>Capture source</span>
        </div>
        {drafts.map((draft) => {
          const blockers = blockersById.get(draft.id) ?? [];
          const verdict = verdicts[draft.id];
          return (
            <div
              key={draft.id}
              className="grid grid-cols-[1fr_11rem] items-center gap-3 border-t border-neutral-800 pt-2"
            >
              <div className="min-w-0 space-y-0.5">
                <Link href={`/events/${draft.id}/edit`} className={`text-sm ${TEXT_LINK}`}>
                  {draft.title}
                </Link>
                {blockers.length > 0 && (
                  <p className="text-xs text-neutral-500">
                    Needs a manual pass: {blockers.join(", ").toLowerCase()}
                  </p>
                )}
                {verdict && !verdict.published && (
                  <p className="text-xs text-red-400">{verdict.message}</p>
                )}
                {verdict?.published && (
                  <p className="text-xs text-orange-300">Published.</p>
                )}
              </div>
              <Select
                variant="compact"
                aria-label={`Capture source for ${draft.title}`}
                value={picks[draft.id] ?? NOT_NOW}
                disabled={blockers.length > 0 || publish.loading}
                onChange={(e) =>
                  changePicks((prev) => ({ ...prev, [draft.id]: e.target.value }))
                }
              >
                <option value={NOT_NOW}>Not now</option>
                {captureSources.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
      </div>

      {publish.error && <p className={FORM_ERROR_BANNER}>{publish.error}</p>}
      {summary && (
        <p className={FORM_SUCCESS_BANNER}>
          {summary.published} published
          {summary.failed > 0 &&
            `, ${summary.failed} kept as ${summary.failed === 1 ? "a draft" : "drafts"}`}
          .
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!ready || publish.loading} onClick={() => publish.run()}>
          {publish.loading
            ? "Publishing…"
            : `Publish ${selected.length} draft${selected.length === 1 ? "" : "s"}`}
        </Button>
        <span className="text-xs text-neutral-500">
          {selectedConflictIds.length === 0
            ? "Pick a conflict to publish."
            : "Publishing is final: a geolocated event is frozen."}
        </span>
      </div>
    </Card>
  );
}

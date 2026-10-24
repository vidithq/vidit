"use client";

import { useState } from "react";
import { Merge } from "lucide-react";

import { Button } from "./Button";
import { Select } from "./Input";

/**
 * Merge one item of a list into another: **Merge** opens a pick of the item to keep and a
 * confirm, so a stray click merges nothing. The caller does the merge in `onMerge` (keep the
 * picked target, fold this item into it, drop this item). Renders nothing without a target.
 */
export function MergeAction({
  subject,
  targets,
  onMerge,
}: {
  /** The item this control folds away ("Source 2"), for the names. */
  subject: string;
  targets: { key: string; label: string }[];
  onMerge: (targetKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  if (targets.length === 0) return null;
  const chosen = targets.some((t) => t.key === target) ? target : targets[0].key;

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)} aria-label={`Merge ${subject}`}>
        <Merge size={13} />
        Merge
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Merge ${subject}`}>
      <span className="text-xs text-neutral-400">Move its links into</span>
      <Select
        variant="compact"
        aria-label={`Source to keep when merging ${subject}`}
        value={chosen}
        onChange={(e) => setTarget(e.target.value)}
      >
        {targets.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(false);
          onMerge(chosen);
        }}
      >
        Merge
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

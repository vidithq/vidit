"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FORM_ERROR_BANNER, FORM_LABEL, LIST_TILE } from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { errorMessage } from "@/lib/api";
import { safeHostname } from "@/lib/format";
import {
  LEVEL_LABELS,
  SOURCE_PICKER_MIN_QUERY,
  searchSources,
  type SourcePick,
} from "@/lib/sources";

/**
 * **Copy an existing source**: a search over the sources of readable events, by URL or title
 * (`GET /sources`), and one **Copy** per hit. A pick hands the whole source to `onPick`, which
 * fills a new editor from it; the write then copies its file onto this event.
 */
export function SourcePicker({
  onPick,
  onClose,
  disabled = false,
}: {
  onPick: (pick: SourcePick) => void;
  onClose: () => void;
  /** At the source cap: the hits show, the copy buttons do not act. */
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SourcePick[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();

  useDebouncedEffect(
    () => {
      if (q.length < SOURCE_PICKER_MIN_QUERY) {
        setHits(null);
        return;
      }
      let live = true;
      searchSources(q)
        .then((rows) => {
          if (!live) return;
          setHits(rows);
          setError(null);
        })
        .catch((err) => {
          if (live) setError(errorMessage(err, "Couldn't search the sources."));
        });
      return () => {
        live = false;
      };
    },
    [q],
    300
  );

  return (
    <div className={`${LIST_TILE} space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="source-picker-query" className={FORM_LABEL}>
          Copy an existing source
        </label>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <Input
        id="source-picker-query"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Paste a URL or type part of a title"
        autoComplete="off"
      />
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {q.length > 0 && q.length < SOURCE_PICKER_MIN_QUERY && (
        <p className="text-xs text-neutral-500">
          Type at least {SOURCE_PICKER_MIN_QUERY} characters.
        </p>
      )}
      {hits !== null && hits.length === 0 && (
        <p className="text-xs text-neutral-500">No source matches.</p>
      )}
      {hits !== null && hits.length > 0 && (
        <ul className="space-y-2" aria-label="Matching sources">
          {hits.map((hit) => {
            const label = hit.title || safeHostname(hit.links[0]?.url ?? "") || "Untitled source";
            return (
              <li key={hit.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm text-neutral-200">
                    <span className="truncate">{label}</span>
                    <Pill tone="neutral">{LEVEL_LABELS[hit.level]}</Pill>
                    {!hit.media && <Pill tone="neutral">No file</Pill>}
                  </p>
                  <p className="truncate text-xs text-neutral-500">From {hit.event_title}</p>
                </div>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onPick(hit)}
                  aria-label={`Copy ${label}`}
                >
                  <Copy size={13} />
                  Copy
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

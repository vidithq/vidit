"use client";

import { useState } from "react";

import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import {
  checkSource,
  isImageryKind,
  type ImageryProvider,
  type SourceCheck,
  type SourceDraft,
} from "@/lib/sources";

import { SourceWarnings } from "./SourceWarnings";

// "Analyst paused typing" threshold, as the duplicate probe.
const CHECK_DEBOUNCE_MS = 500;

/**
 * The imagery provider check of a satellite or aircraft source editor, run as the analyst types
 * (`POST /sources/check`): each provider a link opens, with how a reader reopens the image and
 * the credit it carries, then the warnings the saved source would show. Renders nothing for
 * another kind, and an empty live region while the check has not answered or failed: it is
 * advice, never a gate.
 */
export function SourceImageryCheck({ draft, name }: { draft: SourceDraft; name: string }) {
  const [check, setCheck] = useState<SourceCheck | null>(null);
  const kind = draft.kind;
  const fields = isImageryKind(kind)
    ? JSON.stringify([
        kind,
        draft.capturedAt,
        draft.links.map((link) => [link.url.trim(), link.snapshotUrl.trim()]),
      ])
    : null;

  useDebouncedEffect(
    () => {
      if (!isImageryKind(kind)) {
        setCheck(null);
        return;
      }
      let live = true;
      checkSource({ ...draft, kind })
        .then((result) => {
          if (live) setCheck(result);
        })
        .catch(() => {
          if (live) setCheck(null);
        });
      return () => {
        live = false;
      };
    },
    [fields],
    CHECK_DEBOUNCE_MS
  );

  if (fields === null) return null;
  const providers = new Map<string, ImageryProvider>();
  for (const { provider } of check?.links ?? []) {
    // A provider no reader can reopen speaks through its warning.
    if (provider && provider.group !== "not_reopenable") providers.set(provider.id, provider);
  }
  return (
    <div className="space-y-2 empty:hidden" aria-live="polite">
      {[...providers.values()].map((provider) => (
        <div key={provider.id} className="space-y-0.5 text-xs">
          <p className="font-medium text-neutral-200">{provider.name}</p>
          <p className="text-neutral-400">{provider.help}</p>
          <p className="text-neutral-500">Credit: {provider.credit}</p>
        </div>
      ))}
      <SourceWarnings warnings={check?.warnings ?? []} label={`Warnings of ${name}`} />
    </div>
  );
}

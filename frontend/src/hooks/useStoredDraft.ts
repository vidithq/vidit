"use client";

import { useEffect, useRef, useState } from "react";

import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { canStoreDrafts, clearDraft, readDraft, writeDraft } from "@/lib/drafts";

const DRAFT_SAVE_MS = 250;

/**
 * Keeps a form's draft across a reload. Once `key` is known, it reads the draft stored under it
 * and hands it to `restore`, then turns `ready`: render the fields only then, since an editor
 * reads its seed once. From there it stores `draft` each time it rests. `clear` drops the stored
 * draft and stops storing: call it once the form's write lands. Without a store in the browser,
 * it is ready as soon as `key` is known, and stores nothing.
 *
 * `draft` must be memoised on its fields: a new object is a change to store.
 */
export function useStoredDraft<T>(
  key: string | null,
  draft: T,
  restore: (stored: T) => void,
): { ready: boolean; clear: () => void } {
  const [stores] = useState(canStoreDrafts);
  const [readKey, setReadKey] = useState<string | null>(null);
  const cleared = useRef(false);
  const ready = key !== null && (!stores || readKey === key);

  useEffect(() => {
    if (key === null || !stores) return;
    let live = true;
    void readDraft<T>(key).then((stored) => {
      if (!live) return;
      if (stored !== null) restore(stored);
      setReadKey(key);
    });
    return () => {
      live = false;
    };
    // `restore` is a fresh closure every render; the read runs once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stores]);

  useDebouncedEffect(
    () => {
      if (stores && ready && key !== null && !cleared.current) void writeDraft(key, draft);
    },
    [stores, ready, key, draft],
    DRAFT_SAVE_MS,
  );

  return {
    ready,
    clear: () => {
      cleared.current = true;
      if (stores && key !== null) void clearDraft(key);
    },
  };
}

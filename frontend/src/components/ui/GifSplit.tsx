"use client";

import { useEffect } from "react";

import { TileNotice } from "@/components/ui/TileNotice";
import { useFlash } from "@/hooks/useFlash";

const SPLIT_NOTE_MS = 4000;

/**
 * A GIF split into its frames, in the media slot that picked it: while it runs, a tile in place
 * of the empty slot with the pulsing dot and *Splitting scan.gif into 3 frames…*. `done` is the
 * line under the first frame's slot once it lands, *scan.gif became 3 images.*, which empties
 * after a few seconds; re-key it to show it again. The proof editor's image block and a source's
 * file slot both render it.
 */
export function GifSplit({
  name,
  frames,
  done = false,
}: {
  name: string;
  frames: number;
  done?: boolean;
}) {
  if (done) return <SplitNote name={name} frames={frames} />;
  return (
    <div
      role="status"
      className="aspect-video w-full overflow-hidden rounded-md border border-neutral-700 bg-neutral-950"
    >
      <TileNotice busy>{`Splitting ${name} into ${frames} frames…`}</TileNotice>
    </div>
  );
}

function SplitNote({ name, frames }: { name: string; frames: number }) {
  const { on, flash } = useFlash(SPLIT_NOTE_MS);
  useEffect(flash, [flash]);
  return (
    <p role="status" className="text-xs text-neutral-500">
      {on && `${name} became ${frames} images.`}
    </p>
  );
}

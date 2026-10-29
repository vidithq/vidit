"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { GraphicContentGate } from "@/components/ui/GraphicContentGate";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import { HOVER_REVEAL } from "@/components/ui/styles";
import { MediaManager } from "@/components/geolocations/MediaManager";
import { MOCK_MEDIA, Variant, type PaletteCategory } from "./shared";

// No sample clip ships with the repo: without NEXT_PUBLIC_DEMO_VIDEO_URL (an `.mp4`, since the
// download is named `demo.mp4`) the player gets a source it cannot fetch and shows its failure
// notice.
const VIDEO_SRC = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL ?? "/palette-demo-placeholder.mp4";

const TILE = "w-full max-w-sm";
const FRAME = "relative overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800";

function PaletteMediaLightbox() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button action="show" variant="secondary" onClick={() => setOpen(true)}>
        Open the viewer
      </Button>
      {open && <MediaLightbox source={MOCK_MEDIA} alt="Palette demo media" onClose={() => setOpen(false)} />}
    </>
  );
}

function PaletteMediaManager() {
  const [staged, setStaged] = useState<File[]>([]);
  return (
    <div className="w-64">
      <MediaManager
        staged={staged}
        onAddFiles={staged.length ? undefined : setStaged}
        onRemoveStaged={() => setStaged([])}
      />
    </div>
  );
}

export const MEDIA: PaletteCategory = {
  id: "media",
  title: "Media",
  entries: [
    {
      entry: "MediaGallery",
      demo: (
        <>
          <div className={TILE}>
            <MediaGallery media={MOCK_MEDIA} alt="Strike on a depot" />
          </div>
          <Variant label="panel" className="w-64">
            <MediaGallery media={MOCK_MEDIA} alt="Strike on a depot" variant="panel" />
          </Variant>
          <Variant label="video" className={TILE}>
            <MediaGallery
              media={{ ...MOCK_MEDIA, id: "v1", kind: "video", storage_url: VIDEO_SRC }}
              alt="Footage of the strike"
            />
          </Variant>
        </>
      ),
    },
    {
      entry: "TileNotice",
      demo: (
        <>
          <div className={TILE}>
            <MediaGallery media={null} alt="Strike on a depot" />
          </div>
          <Variant label="compact" className="w-64">
            <MediaGallery media={null} alt="Strike on a depot" variant="panel" empty="No file" />
          </Variant>
        </>
      ),
    },
    {
      entry: "GraphicContentGate",
      demo: (
        <>
          <div className={TILE}>
            <GraphicContentGate>
              <div className="h-40 rounded-lg border border-neutral-700 bg-neutral-800" />
            </GraphicContentGate>
          </div>
          <Variant label="compact">
            <div className="relative aspect-video w-28 overflow-hidden rounded-md bg-neutral-800">
              <GraphicContentGate variant="compact">
                <div className="h-full w-full bg-neutral-700" />
              </GraphicContentGate>
            </div>
          </Variant>
        </>
      ),
    },
    { entry: "MediaLightbox", demo: <PaletteMediaLightbox /> },
    {
      entry: "MediaDownloadButton / FLOATING_CONTROL / HOVER_REVEAL",
      demo: (
        <>
          <div className={`flex size-16 items-center justify-center ${FRAME}`}>
            <MediaDownloadButton source={MOCK_MEDIA} />
          </div>
          <Variant label="HOVER_REVEAL">
            <div className={`group h-24 w-40 ${FRAME}`}>
              <div className={`absolute top-2 right-2 ${HOVER_REVEAL}`}>
                <MediaDownloadButton source={MOCK_MEDIA} />
              </div>
            </div>
          </Variant>
        </>
      ),
    },
    { entry: "FileManager / MediaManager", demo: <PaletteMediaManager /> },
  ],
};

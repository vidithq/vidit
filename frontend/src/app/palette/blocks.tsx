"use client";

import { useState } from "react";

import { Combobox } from "@/components/ui/Combobox";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { ACCENT_RAMP, CHART_NEUTRAL, TOOLTIP_SURFACE } from "@/components/ui/styles";
import { Variant, type PaletteCategory, VIDEO_SRC } from "./shared";

const CITIES = ["Kharkiv", "Kherson", "Kyiv", "Lviv", "Odesa"];

function PaletteCombobox() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const options = CITIES.filter((city) => city.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="w-64 max-w-full">
      <Combobox
        aria-label="City"
        placeholder="Search cities"
        query={query}
        onQueryChange={setQuery}
        open={open}
        onOpenChange={setOpen}
        options={options}
        optionKey={(city) => city}
        renderOption={(city) => city}
        pillOption={() => true}
        onPick={() => {
          setQuery("");
          setOpen(false);
        }}
        status={options.length === 0 ? "No match." : null}
      />
    </div>
  );
}

export const BLOCKS: PaletteCategory = {
  id: "blocks",
  title: "Building blocks",
  tier: "low",
  entries: [
    { entry: "Combobox", demo: <PaletteCombobox /> },
    {
      entry: "VideoPlayer",
      demo: (
        <div className="relative h-48 w-full max-w-sm overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800">
          <VideoPlayer src={VIDEO_SRC} source={{ src: VIDEO_SRC, filename: "demo.mp4" }} title="Demo clip" />
        </div>
      ),
    },
  ],
};

export const LOW_TOKENS: PaletteCategory = {
  id: "low-tokens",
  title: "Tokens",
  tier: "low",
  entries: [
    {
      entry: "ACCENT_RAMP / CHART_NEUTRAL",
      demo: (
        <>
          <Variant label="ACCENT_RAMP">
            <span className="flex gap-1">
              {ACCENT_RAMP.map((paint) => (
                <span key={paint} className={`size-5 rounded-xs ${paint}`} />
              ))}
            </span>
          </Variant>
          <Variant label="CHART_NEUTRAL">
            <span className={`block size-5 rounded-xs ${CHART_NEUTRAL}`} />
          </Variant>
        </>
      ),
    },
    {
      entry: "TOOLTIP_SURFACE",
      demo: <span className={`inline-block rounded-md px-2 py-1 text-xs ${TOOLTIP_SURFACE}`}>maya</span>,
    },
  ],
};

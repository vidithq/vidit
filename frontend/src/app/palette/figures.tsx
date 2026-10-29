"use client";

import { Bot, Camera, Download, MapPin, Swords, Upload } from "lucide-react";

import { ActivityHeatmap } from "@/components/ui/ActivityHeatmap";
import { NumberedSteps } from "@/components/ui/NumberedSteps";
import { ProgressSteps } from "@/components/ui/ProgressSteps";
import { SourceHostBar } from "@/components/ui/SourceHostBar";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import { Variant, type PaletteCategory } from "./shared";

const IMPORT_STEPS = [
  "Filtering out private data",
  "Uploading your archive",
  "Queued for import",
  "Extracting geolocations",
  "Done",
];

const monthly = (year: number, firstMonth: number, counts: number[]) =>
  counts.map((count, i) => ({ period: `${year}-${String(firstMonth + i).padStart(2, "0")}`, count }));

const NARROW = "w-full max-w-xs";

export const FIGURES: PaletteCategory = {
  id: "figures",
  title: "Figures and steps",
  tier: "high",
  entries: [
    {
      entry: "StatTile / StatGrid",
      demo: (
        <div className="w-full max-w-xl">
          <StatGrid>
            <StatTile icon={MapPin} label="Geolocated" value={42} href="/search?type=event&status=geolocated" />
            <StatTile icon={Bot} label="Detected" value={128} href="/search?type=event&status=detected" />
            <StatTile
              icon={Swords}
              label="Top conflict"
              small
              value="Russo-Ukrainian War"
              href="/search?type=event&conflict=Russo-Ukrainian+War"
            />
            <StatTile icon={Camera} label="Top source kind" small value="None" />
          </StatGrid>
        </div>
      ),
    },
    {
      entry: "SourceHostBar",
      demo: (
        <>
          <div className={NARROW}>
            <SourceHostBar
              hosts={[
                { name: "x.com", count: 33 },
                { name: "t.me", count: 14 },
                { name: "tiktok.com", count: 1 },
              ]}
              otherCount={0}
              noSourceCount={0}
            />
          </div>
          <Variant label="other and no source" className={NARROW}>
            <SourceHostBar
              hosts={[
                { name: "x.com", count: 12 },
                { name: "t.me", count: 9 },
                { name: "youtube.com", count: 5 },
                { name: "vk.com", count: 4 },
                { name: "tiktok.com", count: 2 },
              ]}
              otherCount={6}
              noSourceCount={3}
            />
          </Variant>
          <Variant label="empty" className={NARROW}>
            <SourceHostBar hosts={[]} otherCount={0} noSourceCount={0} />
          </Variant>
        </>
      ),
    },
    {
      entry: "ActivityHeatmap",
      demo: (
        <>
          <div className={NARROW}>
            <ActivityHeatmap
              buckets={[...monthly(2025, 3, [4, 0, 7, 2, 0, 0, 11, 5, 1, 3]), ...monthly(2026, 1, [0, 2, 9, 6, 0, 1])]}
            />
          </div>
          <Variant label="one month" className={NARROW}>
            <ActivityHeatmap buckets={[{ period: "2024-05", count: 12 }]} />
          </Variant>
          <Variant label="empty" className={NARROW}>
            <ActivityHeatmap buckets={[]} />
          </Variant>
        </>
      ),
    },
    {
      entry: "NumberedSteps",
      demo: (
        <>
          <Variant label="plain" className={NARROW}>
            <NumberedSteps
              steps={[
                {
                  title: "Pin the visual anchors",
                  body: "Three or more durable features: signage, road geometry, building footprints.",
                },
                {
                  title: "Cross-reference on satellite imagery",
                  body: "Confirm shape, scale, and relative position.",
                },
              ]}
            />
          </Variant>
          <Variant label="boxed" className={NARROW}>
            <NumberedSteps
              variant="boxed"
              steps={[
                { icon: Download, title: "Download the .zip", body: "Save the archive X built for you." },
                {
                  icon: Upload,
                  title: "Upload it here",
                  body: "We map the geolocations in your posts for you to review.",
                },
              ]}
            />
          </Variant>
        </>
      ),
    },
    {
      entry: "ProgressSteps",
      demo: (
        <>
          <Variant label="progress" className={NARROW}>
            <ProgressSteps
              steps={[
                {
                  label: IMPORT_STEPS[0],
                  detail: "DMs, messages and account data never leave your device.",
                  keepDetail: true,
                },
                { label: IMPORT_STEPS[1], progress: 0.62, detail: "381 MB of 612 MB" },
                ...IMPORT_STEPS.slice(2).map((label) => ({ label })),
              ]}
              active={1}
            />
          </Variant>
          <Variant label="spinner" className={NARROW}>
            <ProgressSteps
              steps={IMPORT_STEPS.map((label, i) =>
                i === 2 ? { label, spinner: true, detail: "~3,790 posts in your archive." } : { label },
              )}
              active={2}
            />
          </Variant>
          <Variant label="failed" className={NARROW}>
            <ProgressSteps
              steps={IMPORT_STEPS.map((label, i) =>
                i === 3 ? { label, detail: "The import failed on our side." } : { label },
              )}
              active={3}
              failed
            />
          </Variant>
        </>
      ),
    },
  ],
};

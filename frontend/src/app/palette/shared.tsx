import type { ReactNode } from "react";

import type { EventDetail, Media } from "@/types";
import type { Source } from "@/lib/sources";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { LABEL_TEXT } from "@/components/ui/form-styles";

export type PaletteEntry = { name: string; demo: ReactNode };

export type PaletteCategory = { id: string; title: string; entries: PaletteEntry[] };

export function entryId(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");
}

export function Entry({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div id={entryId(name)} className="scroll-mt-6">
      <Card dense>
        <h3 className="font-mono text-sm font-medium text-neutral-100">{name}</h3>
        <div className="flex flex-wrap items-start gap-4">{children}</div>
      </Card>
    </div>
  );
}

export function Variant({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <p className={LABEL_TEXT}>{label}</p>
      {children}
    </div>
  );
}

// The app's own OG image stands in for stored media: extensionless, so `displayUrlsFor` finds no
// `_hero` / `_thumb` sibling and every size resolves to it.
export const MOCK_MEDIA: Media = {
  id: "m1",
  role: "source",
  storage_url: "/opengraph-image",
  kind: "image",
  sha256: "0".repeat(64),
  original_filename: "strike.jpg",
};

export const MOCK_SOURCE: Source = {
  id: "s1",
  title: "Drone footage of the strike",
  level: "direct",
  kind: "drone",
  captured_at: "2026-05-09T15:40:00Z",
  capture_position: { lat: 48.0201, lng: 37.7951 },
  is_graphic: false,
  links: [
    {
      url: "https://t.me/channel/4242",
      posted_at: "2026-05-09T15:45:00Z",
      archived: {
        url: "https://web.archive.org/web/20260601120000/https://t.me/channel/4242",
        provider: "wayback",
        archived_at: "2026-06-01T12:00:00Z",
      },
    },
    { url: "https://www.youtube.com/watch?v=mirror2", posted_at: null, archived: null },
  ],
  tags: [{ id: "t4", name: "armor" }],
  media: MOCK_MEDIA,
  warnings: [],
};

export const MOCK_CONTEXT_SOURCE: Source = {
  ...MOCK_SOURCE,
  id: "s2",
  title: "",
  level: "context",
  kind: "article",
  captured_at: null,
  capture_position: null,
  links: [{ url: "https://news.example/article", posted_at: null, archived: null }],
  tags: [],
  media: null,
};

export const MOCK_DETAIL: EventDetail = {
  id: "demo",
  title: "Strike on a depot, Donetsk",
  coords: { lat: 48.0159, lng: 37.8024 },
  occurred_date: "2026-05-09",
  is_graphic: false,
  status: "geolocated",
  version_no: 1,
  close_reason: null,
  before_closed_status: null,
  owner: { id: "a1", username: "analyst", avatar_url: null },
  tags: [{ id: "t3", name: "Donetsk" }],
  conflicts: [
    {
      id: "c1",
      name: "Russian invasion of Ukraine",
      wikidata_id: null,
      start_year: 2022,
      end_year: null,
      is_ongoing: true,
      tier: "major",
    },
  ],
  sources: [MOCK_SOURCE, MOCK_CONTEXT_SOURCE],
  occurred_time: "15:45:00",
  detected_from_url: null,
  detected_via: null,
  proof: null,
  created_at: "2026-06-01T00:00:00Z",
  hidden_at: null,
  geolocated_at: "2026-06-03T10:00:00Z",
  closed_at: null,
  thumbnail: null,
  requested_by: null,
  geolocators: [],
};

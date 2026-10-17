import type { Metadata } from "next";

import { formatCoordinates } from "@/lib/coordinates";
import { formatDate } from "@/lib/format";
import type { EventDetail } from "@/types";

import { ogFetch } from "../../_og/data";
import { articleMetadata } from "../../_og/metadata";
import { eventHref } from "@/lib/routes";

// The event page is a client component, so its metadata lives on the segment
// layout: this is the server half of `/events/{id}`, and the only thing it
// renders is its children. Without the tags below a shared event link unfurls
// under the site-wide title and no card, whatever the generated
// `opengraph-image` in this folder produces.
//
// The layout also covers the `edit` child, which inherits the same title and
// card. That page is behind the auth wall and is never the URL anyone shares.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const read = await ogFetch<EventDetail>(`/events/${encodeURIComponent(id)}`);

  // A failed upstream gets no tags (site-wide defaults inherit): "not found" would freeze into crawlers.
  if (read.status === "failed") return {};
  if (read.status === "missing") return articleMetadata({ found: false, noun: "Event" });

  const event = read.data;
  return articleMetadata({
    found: true,
    title: event.title,
    segments: [
      event.event_coords
        ? formatCoordinates(event.event_coords.lat, event.event_coords.lng)
        : null,
      event.event_date ? formatDate(event.event_date) : null,
    ],
    owner: event.owner.username,
    url: eventHref(event.id),
    publishedTime: event.created_at,
  });
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return children;
}

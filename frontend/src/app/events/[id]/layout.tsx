import type { Metadata } from "next";

import { formatCoordinates } from "@/lib/coordinates";
import { formatDate } from "@/lib/format";
import { ogTruncate } from "@/lib/og";
import type { EventDetail } from "@/types";

import { ogFetch } from "../../_og/data";

// The event page is a client component, so its metadata lives on the segment
// layout: this is the server half of `/events/{id}`, and the only thing it
// renders is its children. Without the tags below a shared event link unfurls
// under the site-wide title and no card, whatever the generated
// `opengraph-image` in this folder produces.
//
// The layout also covers the `edit` child, which inherits the same title and
// card. That page is behind the auth wall and is never the URL anyone shares.

/** Title budget, under what X truncates. */
const TITLE_MAX = 90;

/** Description budget, under the ~200 characters X and Discord render. */
const DESCRIPTION_MAX = 180;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const read = await ogFetch<EventDetail>(`/events/${encodeURIComponent(id)}`);

  // A failed upstream gets no tags (site-wide defaults inherit): "not found" would freeze into crawlers.
  if (read.status === "failed") return {};

  if (read.status === "missing") {
    const title = "Event not found on Vidit";
    const description = "This link points at nothing in the catalog.";
    // Same tag shape as the found path, so a dead link still unfurls completely.
    return {
      title,
      description,
      openGraph: { type: "article", title, description, siteName: "Vidit" },
      twitter: { card: "summary_large_image", title, description },
    };
  }

  const event = read.data;
  const title = ogTruncate(event.title, TITLE_MAX);
  const description = ogTruncate(
    [
      event.event_coords
        ? formatCoordinates(event.event_coords.lat, event.event_coords.lng)
        : null,
      event.event_date ? formatDate(event.event_date) : null,
      `Filed by @${event.owner.username} on Vidit.`,
    ]
      .filter(Boolean)
      .join(" · "),
    DESCRIPTION_MAX,
  );

  return {
    title,
    description,
    openGraph: {
      type: "article",
      title,
      description,
      url: `/events/${encodeURIComponent(event.id)}`,
      siteName: "Vidit",
      publishedTime: event.created_at,
    },
    twitter: {
      // 1200×630 card needs the large-image treatment.
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return children;
}

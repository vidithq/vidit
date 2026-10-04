import type { Metadata } from "next";

import { collectionMetaSegments, type Collection } from "@/lib/collections";
import { ogTruncate } from "@/lib/og";

import { ogFetch } from "../../_og/data";

// The collection page is a client component, so its metadata lives on the
// segment layout: this is the server half of `/collections/{id}`, and the only
// thing it renders is its children. Without the tags below a shared collection
// link unfurls under the site-wide title and no card, whatever the generated
// `opengraph-image` in this folder produces.
//
// The layout also covers the `edit` child, which inherits the same title and
// card. That page is behind the auth wall and is never the URL anyone shares.
// `/collections/new` is a sibling of `[id]`, so it inherits nothing from here.

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
  const read = await ogFetch<Collection>(`/collections/${encodeURIComponent(id)}`);

  // A failed upstream gets no tags (site-wide defaults inherit): "not found" would freeze into crawlers.
  if (read.status === "failed") return {};

  if (read.status === "missing") {
    const title = "Collection not found on Vidit";
    const description = "This link points at nothing in the catalog.";
    // Same tag shape as the found path, so a dead link still unfurls completely.
    return {
      title,
      description,
      openGraph: { type: "article", title, description, siteName: "Vidit" },
      twitter: { card: "summary_large_image", title, description },
    };
  }

  const collection = read.data;
  const title = ogTruncate(collection.title, TITLE_MAX);
  // Meta segments in the shared phrasing, then the description as plain text (meta tags carry no marks), then the byline.
  const description = ogTruncate(
    [
      ...collectionMetaSegments(collection),
      collection.description_text,
      `Filed by @${collection.owner.username} on Vidit.`,
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
      url: `/collections/${encodeURIComponent(collection.id)}`,
      siteName: "Vidit",
      publishedTime: collection.created_at,
    },
    twitter: {
      // 1200×630 card needs the large-image treatment.
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function CollectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}

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

/** Title budget, under what X truncates in a card headline. */
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

  // An upstream that failed rather than answered gets no tags at all: the page
  // inherits the site-wide title, description and card, which is the only
  // honest thing to say when we could not read the row. Naming it "not found"
  // here would freeze that answer into every crawler that saw it.
  if (read.status === "failed") return {};

  if (read.status === "missing") {
    const title = "Collection not found on Vidit";
    const description = "This link points at nothing in the catalog.";
    // Same tag shape as the found path, so an unfurl of a dead link is a
    // complete preview rather than a title with nothing under it.
    return {
      title,
      description,
      openGraph: { type: "article", title, description, siteName: "Vidit" },
      twitter: { card: "summary_large_image", title, description },
    };
  }

  const collection = read.data;
  const title = ogTruncate(collection.title, TITLE_MAX);
  // The readings first, in the phrasing every collection surface prints them
  // in (`collectionMetaSegments`), then what the owner says the collection
  // holds, then the byline. The description is read as its plain-text
  // projection: a meta tag carries no marks.
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
      // The generated card is 1200×630, so it wants the large-image treatment
      // rather than the square thumbnail `summary` gives.
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function CollectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}

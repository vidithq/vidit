import type { Metadata } from "next";

import { collectionMetaSegments, type Collection } from "@/lib/collections";

import { ogFetch } from "../../_og/data";
import { articleMetadata } from "../../_og/metadata";

// The collection page is a client component, so its metadata lives on the
// segment layout: this is the server half of `/collections/{id}`, and the only
// thing it renders is its children. Without the tags below a shared collection
// link unfurls under the site-wide title and no card, whatever the generated
// `opengraph-image` in this folder produces.
//
// The layout also covers the `edit` child, which inherits the same title and
// card. That page is behind the auth wall and is never the URL anyone shares.
// `/collections/new` is a sibling of `[id]`, so it inherits nothing from here.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const read = await ogFetch<Collection>(`/collections/${encodeURIComponent(id)}`);

  // A failed upstream gets no tags (site-wide defaults inherit): "not found" would freeze into crawlers.
  if (read.status === "failed") return {};
  if (read.status === "missing") return articleMetadata({ found: false, noun: "Collection" });

  const collection = read.data;
  return articleMetadata({
    found: true,
    title: collection.title,
    // Meta segments in the shared phrasing, then the description as plain text (meta tags carry no marks).
    segments: [...collectionMetaSegments(collection), collection.description_text],
    owner: collection.owner.username,
    url: `/collections/${encodeURIComponent(collection.id)}`,
    publishedTime: collection.created_at,
  });
}

export default function CollectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

// The version pages are a dynamic `[version]` segment beside the static `edit`
// and `history` ones, so `/events/{id}/vN` stays one path segment, the address
// the history links and the banner both name. Next matches a static segment
// before a dynamic sibling, so `edit` and `history` keep their own routes, and
// anything else that lands here is answered by `parseVersionSegment` refusing
// it: the page calls `notFound()` for every segment that is not `v` followed by
// a version number.
//
// `/events/{id}` is the canonical address of the record. A version page serves
// superseded content at a second address, which is exactly what a crawler must
// not index in its place, so this layout adds the two tags that say so. It only
// adds them: the parent `[id]` layout's title, description and card still
// apply, so a pasted version link unfurls as the event it belongs to.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    robots: { index: false, follow: true },
    alternates: { canonical: `/events/${encodeURIComponent(id)}` },
  };
}

export default function EventVersionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

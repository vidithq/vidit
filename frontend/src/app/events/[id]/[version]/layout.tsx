import type { Metadata } from "next";

// `[version]` is a dynamic segment beside static `edit` and `history` (static wins); `parseVersionSegment` refuses
// anything not `v<number>` via `notFound()`.
// `/events/{id}` is canonical, so this layout adds the tags that keep crawlers off the superseded copy; the parent
// layout's title, description and card still apply.

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

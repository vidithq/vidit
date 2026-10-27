import type { Metadata } from "next";
import { siteHref } from "@/lib/sites";

// `[version]` is a dynamic segment beside static `edit`, `history` and `images` (static wins);
// `parseVersionSegment` refuses anything not `v<number>` via `notFound()`. `/sites/{id}` is
// canonical, so this layout keeps crawlers off the superseded copy.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    robots: { index: false, follow: true },
    alternates: { canonical: siteHref(id) },
  };
}

export default function SiteVersionLayout({ children }: { children: React.ReactNode }) {
  return children;
}

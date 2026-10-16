import type { Metadata } from "next";

import { pluralNoun } from "@/lib/format";
import { ogCount } from "@/lib/og";
import { organizationPath, type Organization } from "@/lib/organizations";

import { ogFetch } from "../../_og/data";
import { portfolioMetadata } from "../../_og/metadata";

// The server half of `/organizations/{slug}`: the page is a client component, so its share
// tags live here, built like the analyst profile's.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const read = await ogFetch<Organization>(organizationPath(slug));

  // A failed upstream gets no tags (site-wide defaults inherit): "not found" would freeze into crawlers.
  if (read.status === "failed") return {};

  const org = read.status === "ok" ? read.data : null;
  return portfolioMetadata({
    name: org?.name ?? slug,
    summary: org
      ? `${ogCount(org.member_count)} ${pluralNoun(org.member_count, "member")}.`
      : "No organization on Vidit has this address.",
    bio: org?.bio,
    url: organizationPath(org?.slug ?? slug),
  });
}

export default function OrganizationLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

import { ogCount, ogProfileCounts, ogTruncate } from "@/lib/og";
import type { PublicProfile, UserStats } from "@/lib/users";

import { ogFetch } from "../../_og/data";
import { portfolioMetadata } from "../../_og/metadata";
import { profileHref } from "@/lib/routes";

// The profile page is a client component, so its metadata lives on the segment
// layout: this is the server half of `/profile/{username}`, and the only thing
// it renders is its children. Without the tags below a shared profile link
// unfurls under the site-wide title and no card, whatever the generated
// `opengraph-image` in this folder produces.
//
// The layout also covers the owner-only `detections` child. That child inherits
// a card built from public profile data, which is what the parent URL shows
// anyway.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const path = encodeURIComponent(username);
  // The same two reads as the card, so the data cache answers one of them for the other.
  const [read, statsRead] = await Promise.all([
    ogFetch<PublicProfile>(`/users/${path}`),
    ogFetch<UserStats>(`/users/${path}/stats`),
  ]);

  // A failed upstream gets no tags (site-wide defaults inherit): "not found" would freeze into crawlers.
  if (read.status === "failed") return {};

  const profile = read.status === "ok" ? read.data : null;
  const handle = ogTruncate(profile?.username ?? username, 40);
  const stats = statsRead.status === "ok" ? statsRead.data : null;

  return portfolioMetadata({
    name: handle,
    username: handle,
    summary: profile
      ? `${ogProfileCounts(profile, stats)
          .map(({ label, value }) => `${ogCount(value)} ${label.toLowerCase()}`)
          .join(", ")}.`
      : "This handle has no profile on Vidit.",
    bio: profile?.bio,
    url: profileHref(profile?.username ?? username),
  });
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}

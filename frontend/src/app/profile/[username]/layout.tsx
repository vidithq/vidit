import type { Metadata } from "next";

import { ogCount, ogTruncate } from "@/lib/og";
import type { PublicProfile } from "@/lib/users";

import { ogFetch } from "../../_og/data";
import { portfolioMetadata } from "../../_og/metadata";

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
  const read = await ogFetch<PublicProfile>(`/users/${encodeURIComponent(username)}`);

  // A failed upstream gets no tags (site-wide defaults inherit): "not found" would freeze into crawlers.
  if (read.status === "failed") return {};

  const profile = read.status === "ok" ? read.data : null;
  const handle = ogTruncate(profile?.username ?? username, 40);

  // `geolocations_count` is the published-geolocation figure the card (GEOLOCATED) and Insights both name.
  return portfolioMetadata({
    name: handle,
    username: handle,
    summary: profile
      ? `${ogCount(profile.geolocations_count)} geolocated, ${ogCount(profile.followers_count)} followers.`
      : "This handle has no profile on Vidit.",
    bio: profile?.bio,
    url: `/profile/${encodeURIComponent(profile?.username ?? username)}`,
  });
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}

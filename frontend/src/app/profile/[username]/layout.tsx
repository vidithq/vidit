import type { Metadata } from "next";

import { ogCount, ogTruncate } from "@/lib/og";
import type { PublicProfile } from "@/lib/users";

import { ogFetch } from "../../_og/data";

// The profile page is a client component, so its metadata lives on the segment
// layout: this is the server half of `/profile/{username}`, and the only thing
// it renders is its children. Without the tags below a shared profile link
// unfurls under the site-wide title and no card, whatever the generated
// `opengraph-image` in this folder produces.
//
// The layout also covers the owner-only `detections` child. That child inherits
// a card built from public profile data, which is what the parent URL shows
// anyway.

/** Description budget, under the ~200 characters X and Discord render. */
const DESCRIPTION_MAX = 180;

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
  const title = `@${handle} on Vidit`;

  // `geolocations_count` is the published-geolocation figure the card (GEOLOCATED) and Insights both name.
  const counts = profile
    ? `${ogCount(profile.geolocations_count)} geolocated, ${ogCount(profile.followers_count)} followers.`
    : "This handle has no profile on Vidit.";
  const description = ogTruncate(
    profile?.bio ? `${counts} ${profile.bio}` : counts,
    DESCRIPTION_MAX,
  );

  return {
    title,
    description,
    openGraph: {
      type: "profile",
      username: handle,
      title,
      description,
      url: `/profile/${encodeURIComponent(profile?.username ?? username)}`,
      siteName: "Vidit",
    },
    twitter: {
      // 1200×630 card needs the large-image treatment.
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}

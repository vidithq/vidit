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

  // An upstream that failed rather than answered gets no tags at all: the page
  // inherits the site-wide title, description and card, which is the only
  // honest thing to say when we could not read the handle. Naming it "not
  // found" here would freeze that answer into every crawler that saw it.
  if (read.status === "failed") return {};

  const profile = read.status === "ok" ? read.data : null;
  const handle = ogTruncate(profile?.username ?? username, 40);
  const title = `@${handle} on Vidit`;

  // `geolocations_count` is the analyst's published geolocations, the figure
  // the card headlines under GEOLOCATED and the page names the same way in
  // Insights, so an unfurl, the card and the page all read the same word.
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
      // The generated card is 1200×630, so it wants the large-image treatment
      // rather than the square thumbnail `summary` gives.
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}

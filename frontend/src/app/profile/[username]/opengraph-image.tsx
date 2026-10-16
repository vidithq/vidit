import { ogCount, ogTruncate } from "@/lib/og";
import type { PublicProfile, UserStats } from "@/lib/users";

import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  ogFailedReadResponse,
  ogImageResponse,
} from "../../_og/card";
import { ogImageDataUri, ogFetch } from "../../_og/data";
import { PortfolioCard, PortfolioNotFoundCard } from "../../_og/portfolio";

// `og:image` for `/profile/{username}`: the analyst's portfolio as a share
// card. Reads the same two public payloads the page itself renders from, in
// parallel (`GET /users/{username}` for the identity and the follow counts,
// `GET /users/{username}/stats` for the shape of the work), so an unfurl costs
// one round of requests and never a chain of them. Both are anonymous reads of
// live rows only, which is what keeps the card inside the page's visibility:
// a soft-deleted analyst 404s upstream and lands on the fallback below.

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "An analyst's portfolio on Vidit: handle, geolocation count, and followers.";

export default async function ProfileOpenGraphImage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const path = encodeURIComponent(username);

  const [profileRead, statsRead] = await Promise.all([
    ogFetch<PublicProfile>(`/users/${path}`),
    ogFetch<UserStats>(`/users/${path}/stats`),
  ]);

  if (profileRead.status === "missing") {
    return ogImageResponse(
      <PortfolioNotFoundCard
        title="No analyst here"
        line={`${ogTruncate(username, 40)} has no profile on Vidit.`}
      />,
    );
  }
  // A failed read says nothing about the handle, so neither does the card.
  if (profileRead.status === "failed") {
    return ogFailedReadResponse();
  }

  const profile = profileRead.data;
  const stats = statsRead.status === "ok" ? statsRead.data : null;

  // The avatar URL arrives with the profile, so it is budgeted tighter; a miss costs the monogram, not the card.
  const avatar = await ogImageDataUri(profile.avatar_url);

  // The headline reads off the profile payload (equals `stats.geolocated_count`), so it survives a failed stats read; stats fill the caption and media tile.
  const conflicts = (stats?.top_conflicts ?? []).map((c) => c.name).join(" · ");

  return ogImageResponse(
    <PortfolioCard
      badge="Analyst"
      caption={conflicts ? ogTruncate(conflicts, 60) : undefined}
      avatar={avatar}
      name={profile.username}
      bio={profile.bio}
      stats={[
        { value: ogCount(profile.geolocations_count), label: "Geolocated" },
        { value: ogCount(profile.followers_count), label: "Followers" },
        ...(stats ? [{ value: ogCount(stats.media_count), label: "Media" }] : []),
      ]}
    />,
  );
}

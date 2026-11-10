import { ogCount, ogProfileCounts, ogTruncate } from "@/lib/og";
import { userPath, type PublicProfile, type UserStats } from "@/lib/users";

import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgNotFoundCard,
  ogFailedReadResponse,
  ogImageResponse,
} from "../../_og/card";
import { ogImageDataUri, ogFetch } from "../../_og/data";
import { PortfolioCard } from "../../_og/portfolio";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt =
  "An analyst's portfolio on Vidit: handle, geolocated and detected counts, and followers.";

export default async function ProfileOpenGraphImage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  const [profileRead, statsRead] = await Promise.all([
    ogFetch<PublicProfile>(userPath(username)),
    ogFetch<UserStats>(`${userPath(username)}/stats`),
  ]);

  if (profileRead.status === "missing") {
    return ogImageResponse(
      <OgNotFoundCard
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

  // The avatar URL arrives with the profile, so its read waits on it; a miss costs the monogram, not the card.
  const avatar = await ogImageDataUri(profile.avatar_url);

  const conflicts = (stats?.top_conflicts ?? []).map((c) => c.name).join(" · ");
  const counts = [
    ...ogProfileCounts(profile, stats),
    ...(stats ? [{ label: "Media", value: stats.media_count }] : []),
  ];

  return ogImageResponse(
    <PortfolioCard
      badge="Analyst"
      caption={conflicts ? ogTruncate(conflicts, 60) : undefined}
      avatar={avatar}
      name={profile.username}
      bio={profile.bio}
      stats={counts.map(({ label, value }) => ({ label, value: ogCount(value) }))}
    />,
  );
}

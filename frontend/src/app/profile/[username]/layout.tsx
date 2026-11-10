import type { Metadata } from "next";

import { ogCount, ogProfileCounts, ogTruncate } from "@/lib/og";
import { userPath, type PublicProfile, type UserStats } from "@/lib/users";

import { ogFetch } from "../../_og/data";
import { portfolioMetadata } from "../../_og/metadata";
import { profileHref } from "@/lib/routes";

// The page is a client component, so its metadata lives on this layout.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  // The same two reads as the card, so the data cache answers one of them for the other.
  const [read, statsRead] = await Promise.all([
    ogFetch<PublicProfile>(userPath(username)),
    ogFetch<UserStats>(`${userPath(username)}/stats`),
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

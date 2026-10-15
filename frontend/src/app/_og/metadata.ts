import type { Metadata } from "next";

import { ogTruncate } from "@/lib/og";

/** Description budget, under the ~200 characters X and Discord render. */
const DESCRIPTION_MAX = 180;

/**
 * Page tags for a public profile, an analyst's or an organization's: `<name> on Vidit`, the
 * counts line followed by the bio, and the large-image card the segment's `opengraph-image`
 * renders. `username` marks an analyst (`og:type` `profile`); an organization is a `website`.
 */
export function portfolioMetadata({
  name,
  summary,
  bio,
  url,
  username,
}: {
  name: string;
  summary: string;
  bio?: string | null;
  url: string;
  username?: string;
}): Metadata {
  const title = `${ogTruncate(name, 40)} on Vidit`;
  const description = ogTruncate(bio ? `${summary} ${bio}` : summary, DESCRIPTION_MAX);
  return {
    title,
    description,
    openGraph: {
      ...(username ? { type: "profile" as const, username } : { type: "website" as const }),
      title,
      description,
      url,
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

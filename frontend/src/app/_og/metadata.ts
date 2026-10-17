import type { Metadata } from "next";

import { ogTruncate } from "@/lib/og";

/** Description budget, under the ~200 characters X and Discord render. */
const DESCRIPTION_MAX = 180;

/** Title budget, under what X truncates. */
const ARTICLE_TITLE_MAX = 90;

export function staticPageMetadata({
  path,
  title,
  description,
  shareDescription = description,
}: {
  path: string;
  title: string;
  description: string;
  shareDescription?: string;
}): Metadata {
  return {
    title,
    description,
    openGraph: {
      type: "website",
      url: `https://vidit.app${path === "/" ? "" : path}`,
      siteName: "Vidit",
      title,
      description: shareDescription,
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      site: "@vidithq",
      creator: "@vidithq",
      title,
      description: shareDescription,
    },
  };
}

export const NOT_FOUND_LINE = "This link points at nothing in the catalog.";

export function articleMetadata(
  article:
    | { found: false; noun: string }
    | {
        found: true;
        title: string;
        segments: (string | null | undefined)[];
        owner: string;
        url: string;
        publishedTime: string;
      },
): Metadata {
  // Same tag shape as the found path, so a dead link still unfurls completely.
  if (!article.found) {
    const title = `${article.noun} not found on Vidit`;
    const description = NOT_FOUND_LINE;
    return {
      title,
      description,
      openGraph: { type: "article", title, description, siteName: "Vidit" },
      twitter: { card: "summary_large_image", title, description },
    };
  }
  const title = ogTruncate(article.title, ARTICLE_TITLE_MAX);
  const description = ogTruncate(
    [...article.segments, `Filed by ${article.owner} on Vidit.`].filter(Boolean).join(" · "),
    DESCRIPTION_MAX,
  );
  return {
    title,
    description,
    openGraph: {
      type: "article",
      title,
      description,
      url: article.url,
      siteName: "Vidit",
      publishedTime: article.publishedTime,
    },
    twitter: {
      // 1200×630 card needs the large-image treatment.
      card: "summary_large_image",
      title,
      description,
    },
  };
}

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

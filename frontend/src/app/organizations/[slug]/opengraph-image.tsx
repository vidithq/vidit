import { pluralNoun } from "@/lib/format";
import { ogCount, ogTruncate } from "@/lib/og";
import { organizationPath, type Organization } from "@/lib/organizations";

import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  ogFailedReadResponse,
  ogImageResponse,
} from "../../_og/card";
import { ogImageDataUri, ogFetch } from "../../_og/data";
import { PortfolioCard, PortfolioNotFoundCard } from "../../_og/portfolio";

// `og:image` for `/organizations/{slug}`: the analyst profile's card with the organization's
// name, picture, bio and member count, read from the same anonymous payload the page renders.

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "An organization on Vidit: name, picture, and member count.";

export default async function OrganizationOpenGraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const read = await ogFetch<Organization>(organizationPath(slug));

  if (read.status === "missing") {
    return ogImageResponse(
      <PortfolioNotFoundCard
        title="No organization here"
        line={`${ogTruncate(slug, 40)} is not an organization on Vidit.`}
      />,
    );
  }
  if (read.status === "failed") {
    return ogFailedReadResponse();
  }

  const org = read.data;
  const avatar = await ogImageDataUri(org.avatar_url);

  return ogImageResponse(
    <PortfolioCard
      badge="Organization"
      caption={org.x_handle ? `@${org.x_handle} on X` : undefined}
      avatar={avatar}
      name={org.name}
      bio={org.bio}
      stats={[{ value: ogCount(org.member_count), label: pluralNoun(org.member_count, "Member") }]}
    />,
  );
}

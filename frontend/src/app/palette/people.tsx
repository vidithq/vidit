"use client";

import { AuthorByline } from "@/components/ui/AuthorByline";
import { Avatar } from "@/components/ui/Avatar";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { DiscordGlyph, GitHubGlyph, XGlyph } from "@/components/ui/BrandGlyphs";
import { LegalLinks } from "@/components/ui/LegalLinks";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { TEXT_LINK } from "@/components/ui/styles";
import { organizationByline } from "@/lib/organizations";
import { MOCK_DETAIL, Variant, type PaletteCategory } from "./shared";

const APPROVERS = [
  { name: "maya", variant: "analyst" },
  { name: "Open Source Watch", variant: "organization" },
  { name: "bo", variant: "analyst" },
  { name: "cy", variant: "analyst" },
  { name: "dee", variant: "analyst" },
  { name: "Sahel Desk", variant: "organization" },
  { name: "eli", variant: "analyst" },
  { name: "fay", variant: "analyst" },
  { name: "gus", variant: "analyst" },
] as const;

function approvalStamps(approvers: readonly (typeof APPROVERS)[number][]) {
  return approvers.map(({ name, variant }) => ({
    key: name,
    name,
    variant,
    label: name,
    href: "/palette",
  }));
}

const OWNER = MOCK_DETAIL.owner;
const CO_AUTHORS = [{ username: "bo" }, { username: "cy" }];

export const PEOPLE: PaletteCategory = {
  id: "people",
  title: "Accounts and links",
  tier: "high",
  entries: [
    {
      entry: "Avatar",
      demo: (
        <>
          <Variant label="icon">
            <Avatar username="demo" size="w-11 h-11" fallback="icon" />
          </Variant>
          <Variant label="initial">
            <Avatar username="ana-demo" size="size-10" />
          </Variant>
          <Variant label="square">
            <Avatar username="Open Source Watch" size="size-10" shape="square" />
          </Variant>
          <Variant label="src fails">
            <Avatar username="ana-demo" size="size-10" src="/palette/this-avatar-does-not-exist.jpg" />
          </Variant>
          <Variant label="iconClassName">
            <span className="text-orange-400">
              <Avatar
                as="span"
                username="demo"
                size="size-[18px]"
                fallback="icon"
                iconClassName="text-current"
                decorative
              />
            </span>
          </Variant>
        </>
      ),
    },
    {
      entry: "AvatarStack",
      demo: (
        <>
          <AvatarStack label="Approved by" items={approvalStamps(APPROVERS.slice(0, 5))} />
          <Variant label="spacing gap, checked" className="w-56">
            <AvatarStack label="Approved by" spacing="gap" checked items={approvalStamps(APPROVERS)} />
          </Variant>
          <Variant label="remove confirms">
            <AvatarStack
              label="Approved by"
              spacing="gap"
              checked
              items={approvalStamps(APPROVERS.slice(0, 3)).map((stamp) => ({
                ...stamp,
                remove: { label: `Delete approval by ${stamp.name}`, onClick: () => {}, confirms: true },
              }))}
            />
          </Variant>
          <Variant label="muted, remove">
            <AvatarStack
              label="Co-geolocators"
              spacing="gap"
              items={["bo", "cy"].map((name) => ({
                key: name,
                name,
                variant: "analyst" as const,
                label: `${name}, invitation pending`,
                href: "/palette",
                muted: true,
                remove: { label: `Withdraw the invitation of ${name}`, onClick: () => {} },
              }))}
            />
          </Variant>
          <Variant label="organizations">
            <AvatarStack
              label="Organizations"
              items={[
                { name: "Open Source Watch", role: "Org manager" },
                { name: "Sahel Desk", role: "Member" },
              ].map(({ name, role }) => ({
                key: name,
                name,
                variant: "organization" as const,
                label: `${role} of ${name}`,
                href: "/palette",
              }))}
            />
          </Variant>
        </>
      ),
    },
    {
      entry: "AuthorByline",
      demo: (
        <div className="grid gap-4 text-sm text-neutral-400 sm:grid-cols-2">
          <Variant label="avatar">
            <AuthorByline author={OWNER} avatar />
          </Variant>
          <Variant label="default">
            <AuthorByline author={OWNER} />
          </Variant>
          <Variant label="xs" className="text-xs">
            <AuthorByline author={OWNER} size="xs" />
          </Variant>
          <Variant label="coAuthors">
            <AuthorByline author={OWNER} coAuthors={CO_AUTHORS} avatar />
          </Variant>
          <Variant label="coAuthorsAs avatars">
            <AuthorByline author={OWNER} coAuthors={CO_AUTHORS} coAuthorsAs="avatars" avatar />
          </Variant>
          <Variant label="link false" className="text-xs">
            <AuthorByline author={OWNER} prefix={false} link={false} />
          </Variant>
          <Variant label="organizationByline">
            <AuthorByline
              author={organizationByline({ slug: "osw", name: "Open Source Watch" })}
              prefix={false}
              avatar
            />
          </Variant>
        </div>
      ),
    },
    {
      entry: "OutboundLink",
      demo: (
        <>
          <Variant label="known host">
            <OutboundLink href="https://t.me/some_channel/4242" className={TEXT_LINK}>
              t.me/some_channel/4242
            </OutboundLink>
          </Variant>
          <Variant label="unknown host">
            <OutboundLink href="https://example.org/analysis/strike-site" ugc className={TEXT_LINK}>
              example.org/analysis/strike-site
            </OutboundLink>
          </Variant>
        </>
      ),
    },
    {
      entry: "SourceLabel",
      demo: (
        <>
          <SourceLabel url="https://t.me/some_channel/4242" variant="inline" />
          <SourceLabel url="https://www.t.me/some_channel/4242/" variant="link" />
          <SourceLabel url={null} variant="inline" />
        </>
      ),
    },
    { entry: "LegalLinks", demo: <LegalLinks /> },
    {
      entry: "BrandGlyphs",
      demo: (
        <span className="inline-flex items-center gap-3 text-neutral-400">
          <XGlyph />
          <GitHubGlyph />
          <DiscordGlyph />
        </span>
      ),
    },
  ],
};

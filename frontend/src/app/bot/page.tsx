import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AtSign, Reply, History, X, type LucideIcon } from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
import { Pill } from "@/components/ui/Pill";
import { Dot } from "@/components/ui/Dot";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import {
  MOCK_ANALYST,
  MOCK_BOT,
  MockPost,
  MockPostLink,
} from "@/components/ui/MockPost";

// Public guide for the @ViditBot mention format, reachable without an
// account (see `PUBLIC_PREFIXES` in `proxy.ts`) and from the about page's
// Guides section. This is the page the bot's bio and pinned post point to,
// and the destination behind the failure reply's "Guide in bio": the reply
// itself is linkless by contract, so the full lesson lives here. Server
// component for SEO, on the same PageShell + Card scaffolding as the other
// guides (`/guide`, `/methodology`, `/archive`).

// One title, used for the heading, the browser tab and the share card: this
// page is linked from the bot's own X bio and from the about page's Guides
// section, and what a reader clicks is what they should land on.
const TITLE = "Import by tagging @ViditBot";
const SECTION = "text-sm font-medium text-neutral-200";
const DESCRIPTION =
  "Tag @ViditBot on a geolocation post on X and it lands on Vidit as a structured draft: coordinates, source, media, and proof note, ready for your review.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "https://vidit.app/bot",
    siteName: "Vidit",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@vidithq",
    creator: "@vidithq",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// The three lines the bot reads off the post's shape, in order.
const LINES: { step: string; label: string; body: string }[] = [
  {
    step: "1",
    label: "Title",
    body: "The first line of your post that is not just a link becomes the draft's title.",
  },
  {
    step: "2",
    label: "Coordinates",
    body: "One decimal pair alone on its line: 48.123456, 37.654321. Signs and degree symbols are fine; DMS is not.",
  },
  {
    step: "3",
    label: "Source",
    body: "The footage link alone on its line, or quote the source post. Never your own post.",
  },
];

// The shapes that fail (or misfire), so the guide teaches them before the
// failure reply has to.
const MISTAKES: { label: string; body: string }[] = [
  {
    label: "Tagging the first post when relaying",
    body: "The tag goes on the reply that carries the footage. Tag the first post instead and it imports without the footage, and a later tag on the reply is ignored as already imported.",
  },
  {
    label: "Two coordinate lines",
    body: "One post, one pair. Two coordinate-only lines are ambiguous: nothing imports.",
  },
  {
    label: "Two source links",
    body: "Two links each alone on a line, or several links with none alone on its line: nothing imports. Exactly one source, alone on its line.",
  },
  {
    label: "Sourcing your own post",
    body: "A link back to your own post is a cross-reference, never a source. Link the original footage post.",
  },
  {
    label: "Coordinates inside a sentence",
    body: "“Geolocated at 48.123456, 37.654321 by the bridge” is not parsed. The pair must sit alone on its line.",
  },
  {
    label: "Tagging under someone else’s post",
    body: "A relay reply must answer your own post. Tags under anyone else’s import nothing.",
  },
];

// One tagging case as a full-width row: the explanation beside its mock posts
// from `sm` up, stacked on a phone. A row rather than a column in a three-up
// grid, because a mock post squeezed into a third of the page column wraps its
// links and its byline into noise.
function TagCase({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
        <div>
          <span className="size-9 rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center text-orange-400">
            <Icon size={17} />
          </span>
          <h3 className="mt-4 text-sm font-medium text-neutral-100">{title}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">
            {body}
          </p>
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}

export default function BotGuidePage() {
  return (
    <PageShell
      title={TITLE}
      actions={
        <Pill tone="accent" className="gap-2 tracking-tight">
          <Dot />
          <span>@ViditBot · import by tagging</span>
        </Pill>
      }
    >
      <Card as="section">
        <p className="text-sm text-neutral-300 leading-relaxed">
          Tag @ViditBot on a geolocation post on X and it lands on{" "}
          <Link href="/" className={TEXT_LINK}>
            Vidit
          </Link>{" "}
          as a structured draft: coordinates, source, media, and proof note,
          ready for your review. No re-entry, no leaving your feed.
        </p>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>The three lines</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {LINES.map(({ step, label, body }) => (
            <div
              key={step}
              className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-md border border-neutral-700 bg-neutral-800 font-mono text-sm text-orange-400">
                {step}
              </span>
              <h3 className="mt-4 text-sm font-medium text-neutral-100">
                {label}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">
                {body}
              </p>
            </div>
          ))}
        </div>
        <p className="text-[13px] leading-relaxed text-neutral-400">
          Anything else you write in the post is kept as the draft&apos;s proof
          note. Prefer explicit prefixes? Marking the lines{" "}
          <span className="font-mono text-neutral-300">C: coordinates</span> and{" "}
          <span className="font-mono text-neutral-300">S: source</span> works
          too. <span className="font-mono text-neutral-300">T: title</span> is
          optional: leave it out and the first other line that is not just a
          link becomes the title, but an empty{" "}
          <span className="font-mono text-neutral-300">T:</span> line is
          refused.
        </p>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>Three ways to tag</h2>
        <div className="space-y-3">
          <TagCase
            icon={AtSign}
            title="Inline: one post carries everything"
            body="One post carries the tag and the three lines. An X or public Telegram source is fetched for you, footage and post date; quoting it does the same. Any other platform is kept as a link, so a video you attach becomes the footage and photos stay proof."
          >
            <MockPost
              {...MOCK_ANALYST}
              media={{
                kind: "image",
                label: "your annotated screenshots (proof)",
              }}
            >
              {"Strike on the vehicle depot\n48.123456, 37.654321\n"}
              <MockPostLink>x.com/warfootage/status/1783</MockPostLink>
              {"\nSmoke plume matches the skyline.\n"}
              <MockPostLink>@viditbot</MockPostLink>
            </MockPost>
          </TagCase>

          <TagCase
            icon={Reply}
            title="Relay: the footage rides a second post"
            body="Your own re-upload becomes the footage, even where Vidit could fetch the source. Post the title and coordinates, then tag the bot in a direct reply carrying the footage alone. The source link can sit on either post."
          >
            <MockPost {...MOCK_ANALYST}>
              {
                "Strike on the vehicle depot\n48.123456, 37.654321\nSmoke plume matches the skyline."
              }
            </MockPost>
            <div className="pl-6">
              <MockPost
                {...MOCK_ANALYST}
                replyingTo={MOCK_ANALYST.handle}
                media={{
                  kind: "video",
                  label: "the re-uploaded footage (source)",
                }}
              >
                <MockPostLink>tiktok.com/@warfootage/video/7</MockPostLink>
                {"\n"}
                <MockPostLink>@viditbot</MockPostLink>
              </MockPost>
            </div>
          </TagCase>

          <TagCase
            icon={History}
            title="Retro: a post you already published"
            body="Reply to your own post, whatever its age, and tag the bot: the reply needs nothing else. The post itself carries the format, since the bot reads the post you replied to. Direct replies only, and re-tagging cannot duplicate: the draft anchors on the post."
          >
            <MockPost
              {...MOCK_ANALYST}
              media={{
                kind: "image",
                label: "your annotated screenshots (proof)",
              }}
            >
              {"Bridge span dropped overnight\n49.842900, 24.031100\n"}
              <MockPostLink>x.com/warfootage/status/1206</MockPostLink>
              {"\nGeolocated it back in March."}
            </MockPost>
            <div className="pl-6">
              <MockPost {...MOCK_ANALYST} replyingTo={MOCK_ANALYST.handle}>
                <MockPostLink>@viditbot</MockPostLink>
              </MockPost>
            </div>
          </TagCase>
        </div>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>What not to do</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MISTAKES.map(({ label, body }) => (
            <div
              key={label}
              className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-md border border-neutral-700 bg-neutral-800 text-red-400">
                <X size={17} />
              </span>
              <h3 className="mt-4 text-sm font-medium text-neutral-100">
                {label}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">
                {body}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>What happens next</h2>
        <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-neutral-400">
          <li>
            The bot answers in-thread with your draft&apos;s reference, and
            flags a possible duplicate when the media is already on Vidit.
          </li>
          <li>
            The draft is on the map straight away, marked as a machine draft and
            credited to you, and it waits in your detections queue. Review it,
            fix the event date (the post date is only a proxy), then vouch for
            it as a geolocation. Rejecting it takes it down.
          </li>
          <li>
            If the shape is incomplete, the bot replies with the one thing that
            broke; the full format lives in this guide.
          </li>
        </ul>
        <div className="sm:max-w-md">
          <MockPost {...MOCK_BOT} replyingTo={MOCK_ANALYST.handle}>
            {
              "✅ 1 geolocation draft saved · ref 94183d44\nReview it from your profile"
            }
          </MockPost>
        </div>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>Ground rules</h2>
        <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-neutral-400">
          <li>
            The bot only imports for X handles linked to a Vidit account. Not
            linked yet? It stays silent: nothing is created in your name.
          </li>
          <li>
            One draft per post: tagging the same geolocation again collapses
            onto the first import.
          </li>
          <li>
            The bot reads public posts only: tags from a protected account
            cannot import.
          </li>
        </ul>
      </Card>
    </PageShell>
  );
}

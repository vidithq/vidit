import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AtSign, Reply, History, X, type LucideIcon } from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
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
  "Tag @ViditBot on a geolocation post on X. Vidit reads the post and creates a draft with its coordinates, source, media, and proof note.";

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
    body: "One decimal pair alone on its line, for example 48.123456, 37.654321. Signs and degree symbols are accepted. DMS is not.",
  },
  {
    step: "3",
    label: "Source",
    body: "The footage link alone on its line, or a quote of the source post. A link to your own post is not accepted.",
  },
];

// The shapes that fail (or misfire), so the guide teaches them before the
// failure reply has to.
const MISTAKES: { label: string; body: string }[] = [
  {
    label: "Tagging the first post when relaying",
    body: "The tag goes on the reply that carries the footage. Tag the first post instead and it imports without the footage. A later tag on the reply is ignored, because the geolocation is already imported.",
  },
  {
    label: "Two coordinate lines",
    body: "A post must carry exactly one coordinate pair. Two coordinate-only lines are ambiguous and nothing imports.",
  },
  {
    label: "Two source links",
    body: "Nothing imports when two links each sit alone on a line, or when several links appear and none sits alone on a line. Put exactly one source link alone on its line.",
  },
  {
    label: "Sourcing your own post",
    body: "A link to your own post is a cross-reference, not a source. Link the original footage post instead.",
  },
  {
    label: "Coordinates inside a sentence",
    body: "“Geolocated at 48.123456, 37.654321 by the bridge” is not parsed. The pair must sit alone on its line.",
  },
  {
    label: "Tagging under someone else’s post",
    body: "A relay reply must answer your own post. A tag under another account’s post imports nothing.",
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
    <PageShell title={TITLE}>
      <Card as="section">
        <p className="text-sm text-neutral-300 leading-relaxed">
          Tag @ViditBot on a geolocation post on X.{" "}
          <Link href="/" className={TEXT_LINK}>
            Vidit
          </Link>{" "}
          reads the post and creates a draft with its coordinates, source,
          media, and proof note. You do not leave your feed and you retype
          nothing.
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
          Every other line becomes the draft&apos;s proof note. You can also
          mark the lines explicitly with{" "}
          <span className="font-mono text-neutral-300">C: coordinates</span> and{" "}
          <span className="font-mono text-neutral-300">S: source</span>.{" "}
          <span className="font-mono text-neutral-300">T: title</span> is
          optional. Without it, the first line that is not a bare link becomes
          the title. An empty{" "}
          <span className="font-mono text-neutral-300">T:</span> line is
          refused.
        </p>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>Three ways to tag</h2>
        <div className="space-y-3">
          <TagCase
            icon={AtSign}
            title="Inline mention"
            body="One post carries the tag and the three lines. Vidit fetches the footage and post date from an X post, a public Telegram post, or a quote of the source post. It stores a source on any other platform as a link, so a video you attach becomes the footage and photos become proof."
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
            title="Footage relay"
            body="A re-upload you attach to the reply becomes the footage, including where Vidit could fetch the source. Post the title and coordinates, then tag the bot in a direct reply that carries the footage alone. The source link can sit on either post."
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
            title="Retroactive import"
            body="Reply to any of your own posts and tag the bot. The reply needs nothing else. The post you reply to must carry the format, because Vidit reads that post. Only direct replies work, and re-tagging creates no duplicate."
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
            The draft appears on the map immediately, labeled as a machine draft
            and attributed to your account, and it waits in your detections
            queue. Review it, correct the event date, then publish it as a
            geolocation. Rejecting it removes it.
          </li>
          <li>
            If the post does not conform, the bot replies with the reason. This
            guide covers the full format.
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
            The bot imports only for X handles linked to a Vidit account. It
            stays silent for any other handle and creates nothing.
          </li>
          <li>
            Each post produces one draft. Tagging the same geolocation again
            reuses the first import.
          </li>
          <li>
            The bot reads public posts only. A tag from a protected account
            imports nothing.
          </li>
        </ul>
      </Card>
    </PageShell>
  );
}

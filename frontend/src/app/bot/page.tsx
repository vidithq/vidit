import type { Metadata } from "next";
import Link from "next/link";
import { TEXT_LINK } from "@/components/ui/styles";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import {
  MOCK_ANALYST,
  MOCK_BOT,
  MockPost,
  MockPostLink,
} from "@/components/ui/MockPost";

// Public guide for the @ViditBot mention, reachable without an account (see
// `PUBLIC_PREFIXES` in `proxy.ts`) and from the about page's Guides section.
// This is the page the bot's bio and pinned post point to, and the destination
// behind the failure reply's "Guide in bio": the reply itself is linkless by
// contract, so the rules live here. Server component for SEO, on the same
// PageShell + Card scaffolding as the other guides (`/guide`, `/methodology`,
// `/archive`).

// One title, used for the heading, the browser tab and the share card: this
// page is linked from the bot's own X bio and from the about page's Guides
// section, and what a reader clicks is what they should land on.
const TITLE = "Import by tagging @ViditBot";
const SECTION = "text-sm font-medium text-neutral-200";
const DESCRIPTION =
  "Tag @ViditBot on a geolocation post on X. The bot reads the post and creates a draft on Vidit with its coordinates, source, media, and proof note.";

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

// The two rules that decide whether a tag produces anything, then what the
// import makes of the rest of the post.
const RULES: { step: string; label: string; body: string }[] = [
  {
    step: "1",
    label: "A coordinate in your text",
    body: "Your post, or the post of yours it replies to, carries a coordinate anywhere in its text. Decimal pairs, hemisphere letters, DMS and Google Maps links all read.",
  },
  {
    step: "2",
    label: "Your tag",
    body: "Tag @ViditBot on the post. Only your own posts import, so a tag under someone else's post reads only your tag.",
  },
  {
    step: "3",
    label: "A source, if you have one",
    body: "A quote of the source post, or a single link, becomes the source. Several links leave the source empty and land as secondary links you pick from at review.",
  },
];

export default function BotGuidePage() {
  return (
    <PageShell title={TITLE} back backFallback="/about">
      <Card as="section">
        <p className="text-sm text-neutral-300 leading-relaxed">
          Tag @ViditBot on a geolocation post on X. The bot reads the post and
          creates a draft on{" "}
          <Link href="/" className={TEXT_LINK}>
            Vidit
          </Link>{" "}
          with its coordinates, source, media, and proof note. There is no
          format to learn: write your post as you always do. You do not leave
          your feed and you retype nothing.
        </p>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>What the bot needs</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {RULES.map(({ step, label, body }) => (
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
          The draft&apos;s title is the first line of your post that is neither
          a coordinate on its own nor a link on its own. Your whole text becomes
          the proof note, coordinate line included, and you edit it at review. A
          video you attach becomes the footage when nothing else fills that
          slot; photos become proof. Several coordinates in one post make one
          draft each.
        </p>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>Two ways to tag</h2>
        <div className="space-y-3">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h3 className="text-sm font-medium text-neutral-100">
              One post carries everything
            </h3>
            <p className="mt-1.5 mb-4 text-[13px] leading-relaxed text-neutral-400">
              The coordinate, the source link and the tag on the same post.
            </p>
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
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h3 className="text-sm font-medium text-neutral-100">
              Your post, then your own reply
            </h3>
            <p className="mt-1.5 mb-4 text-[13px] leading-relaxed text-neutral-400">
              Post the geolocation, then reply to yourself with the source and
              the tag. The bot reads both posts as one, and the draft is filed
              under the first of them, so tagging either one imports the same
              geolocation once. This is also how you import a post you published
              earlier.
            </p>
            <div className="space-y-3">
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
            </div>
          </div>
        </div>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>What happens next</h2>
        <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-neutral-400">
          <li>
            The bot answers in-thread with your draft&apos;s reference and with
            what to fix at review: an empty source, several coordinates, a
            missing footage file or post date, or media already on Vidit.
          </li>
          <li>
            The draft appears on the map immediately, labeled as a machine draft
            and attributed to your account, and it waits in your detections
            queue. Review it, correct the event date, then publish it as a
            geolocation. Rejecting it removes it.
          </li>
          <li>
            Nothing imports when your text carries no coordinate, when the
            coordinate is out of bounds, or when X will not serve the post. The
            bot replies with which of the three it was.
          </li>
        </ul>
        <div className="sm:max-w-md">
          <MockPost {...MOCK_BOT} replyingTo={MOCK_ANALYST.handle}>
            {
              "✅ 1 geolocation draft saved · ref 94183d44\nReview from your profile"
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
            A coordinate counts only in your own text. One that lives only in a
            post you quote is that author&apos;s geolocation, not yours.
          </li>
          <li>
            Tagging the same geolocation again reuses the first import, so a
            second tag creates no duplicate.
          </li>
          <li>
            The bot reads public posts only. A tag from a protected account
            imports nothing. A retweet imports nothing either: its words are
            someone else&apos;s.
          </li>
        </ul>
      </Card>
    </PageShell>
  );
}

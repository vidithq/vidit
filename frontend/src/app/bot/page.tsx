import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  AtSign,
  Reply,
  ShieldCheck,
  ClipboardCheck,
  Bot,
  Play,
  ImageIcon,
  X,
} from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
import { Pill } from "@/components/ui/Pill";
import { Dot } from "@/components/ui/Dot";
import { PageFrame } from "@/components/ui/PageFrame";

// Public guide for the @ViditBot mention format, reachable without an
// account (see `PUBLIC_PREFIXES` in `proxy.ts`) and from the sidebar's Bot
// entry. This is the page the bot's bio and pinned post point to, and the
// destination behind the failure reply's "Guide in bio": the reply itself
// is linkless by contract, so the full lesson lives here. Server component
// for SEO, composed from the same primitives and section/card markup as
// the landing page; the mock X posts mirror the promo video's BotBeat
// composition (video/src/components/BotBeat.tsx).

const TITLE = "Tag @ViditBot: import a geolocation from one post";
const DESCRIPTION =
  "Tag @ViditBot on a geolocation post on X and it lands on Vidit as a structured draft: coordinates, source, media, and proof note, ready to review and publish.";

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
    body: "The first line of your post becomes the draft's title.",
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

// A mock X post, the same composition the promo video's BotBeat renders:
// X-dark card, avatar, name row, body with link-blue accents, optional
// media placeholder. Page-local content markup, not a product primitive.
function MockPost({
  name,
  handle,
  avatar,
  bot = false,
  replyingTo,
  media,
  children,
}: {
  name: string;
  handle: string;
  avatar: string;
  bot?: boolean;
  replyingTo?: string;
  media?: { kind: "video" | "image"; label: string };
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-black p-4 text-left">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatar}`}
        >
          {bot ? <Bot size={20} /> : name.slice(0, 1)}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-bold text-neutral-100">
            {name}
          </p>
          <p className="truncate text-[13px] text-neutral-500">
            {handle}
            {replyingTo && (
              <>
                {" "}
                · replying to <span className="text-sky-500">{replyingTo}</span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="mt-2.5 whitespace-pre-line text-[14px] leading-[21px] text-neutral-100">
        {children}
      </div>
      {media && (
        <div className="mt-3 flex aspect-video items-center justify-center rounded-xl border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900">
          <span className="flex flex-col items-center gap-2 text-neutral-500">
            <span className="flex size-10 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900">
              {media.kind === "video" ? (
                <Play size={16} />
              ) : (
                <ImageIcon size={16} />
              )}
            </span>
            <span className="text-[11px]">{media.label}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// Link-blue span for the mock bodies (X's anchor color, display only).
function BodyLink({ children }: { children: ReactNode }) {
  return <span className="text-sky-500">{children}</span>;
}

export default function BotGuidePage() {
  return (
    <main className="bg-neutral-950 text-neutral-100">
      <PageFrame>
        <section className="pt-16 pb-12 text-center">
          <Pill tone="accent" className="gap-2 tracking-tight">
            <Dot />
            <span>@ViditBot · import by tagging</span>
          </Pill>
          <h1 className="mt-6 text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1]">
            Tag the bot, keep the geolocation
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-neutral-400 leading-relaxed">
            Tag @ViditBot on a geolocation post on X and it lands on{" "}
            <Link href="/" className={TEXT_LINK}>
              Vidit
            </Link>{" "}
            as a structured draft: coordinates, source, media, and proof note,
            ready to review and publish. No re-entry, no leaving your feed.
          </p>
        </section>

        <section className="pb-16">
          <div className="text-center">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-200">
              The three lines
            </h2>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {LINES.map(({ step, label, body }) => (
              <div
                key={step}
                className="rounded-lg border border-neutral-800 bg-neutral-900 p-5"
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
          <p className="mt-4 text-center text-[13px] leading-relaxed text-neutral-400">
            Anything else you write in the post is kept as the draft&apos;s
            proof note. Prefer explicit prefixes? Writing the three lines as{" "}
            <span className="font-mono text-neutral-300">T: title</span>,{" "}
            <span className="font-mono text-neutral-300">C: coordinates</span>,{" "}
            <span className="font-mono text-neutral-300">S: source</span> works
            too.
          </p>
        </section>

        <section className="pb-16">
          <div className="text-center">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-200">
              Two ways to tag
            </h2>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <span className="size-9 rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center text-orange-400">
                <AtSign size={17} />
              </span>
              <h3 className="mt-4 text-sm font-medium text-neutral-100">
                Inline: the source is on X or Telegram
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">
                One post carrying the tag and the three lines. When the source
                is an X post or a public Telegram post, Vidit fetches the
                footage and its post date for you. Quoting the source post
                works too. Attach your annotated screenshots: they land as
                proof.
              </p>
              <div className="mt-4">
                <MockPost
                  name="GEOIMINT"
                  handle="@GEOIMINT"
                  avatar="bg-gradient-to-br from-orange-500 to-red-600"
                  media={{
                    kind: "image",
                    label: "your annotated screenshots (proof)",
                  }}
                >
                  {"Strike on the vehicle depot\n48.123456, 37.654321\n"}
                  <BodyLink>x.com/warfootage/status/17…</BodyLink>
                  {"\nSmoke plume matches the skyline.\n"}
                  <BodyLink>@viditbot</BodyLink>
                </MockPost>
              </div>
            </div>

            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <span className="size-9 rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center text-orange-400">
                <Reply size={17} />
              </span>
              <h3 className="mt-4 text-sm font-medium text-neutral-100">
                Relay: the source is anywhere else
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">
                TikTok, Instagram, a news article: Vidit cannot fetch footage
                from those, so relay it yourself. Post the three lines, then
                tag the bot in a direct reply to your own post, with the
                footage attached. The reply&apos;s media becomes the source
                footage.
              </p>
              <div className="mt-4 space-y-3">
                <MockPost
                  name="GEOIMINT"
                  handle="@GEOIMINT"
                  avatar="bg-gradient-to-br from-orange-500 to-red-600"
                  media={{
                    kind: "image",
                    label: "your annotated screenshots (proof)",
                  }}
                >
                  {"Strike on the vehicle depot\n48.123456, 37.654321\n"}
                  <BodyLink>tiktok.com/@warfootage/video/7…</BodyLink>
                  {"\nSmoke plume matches the skyline."}
                </MockPost>
                <div className="pl-6">
                  <MockPost
                    name="GEOIMINT"
                    handle="@GEOIMINT"
                    avatar="bg-gradient-to-br from-orange-500 to-red-600"
                    replyingTo="@GEOIMINT"
                    media={{
                      kind: "video",
                      label: "the re-uploaded footage (source)",
                    }}
                  >
                    <BodyLink>@viditbot</BodyLink>
                  </MockPost>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="pb-16">
          <div className="text-center">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-200">
              What not to do
            </h2>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MISTAKES.map(({ label, body }) => (
              <div
                key={label}
                className="rounded-lg border border-neutral-800 bg-neutral-900 p-5"
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
        </section>

        <section className="pb-16">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <span className="size-9 rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center text-orange-400">
                <ClipboardCheck size={17} />
              </span>
              <h3 className="mt-4 text-sm font-medium text-neutral-100">
                What happens next
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-neutral-400">
                <li>
                  The bot answers in-thread with your draft&apos;s reference,
                  and flags a possible duplicate when the media is already on
                  Vidit.
                </li>
                <li>
                  The draft waits in your profile&apos;s detections queue.
                  Review it, fix the event date (the post date is only a
                  proxy), then publish.
                </li>
                <li>
                  If the shape is incomplete, the bot replies with what is
                  missing. Tag again on a corrected post.
                </li>
              </ul>
              <div className="mt-4">
                <MockPost
                  name="Vidit"
                  handle="@viditbot"
                  avatar="bg-gradient-to-br from-orange-500 to-amber-500"
                  bot
                  replyingTo="@GEOIMINT"
                >
                  {
                    "Vidit: 1 geolocation draft saved · ref 94183d44\nReview it from your profile (link in bio)."
                  }
                </MockPost>
              </div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <span className="size-9 rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center text-orange-400">
                <ShieldCheck size={17} />
              </span>
              <h3 className="mt-4 text-sm font-medium text-neutral-100">
                Ground rules
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-neutral-400">
                <li>
                  The bot only imports for X handles linked to a Vidit account.
                  Not linked yet? It stays silent: nothing is created in your
                  name.
                </li>
                <li>
                  One draft per post: tagging the same geolocation again
                  collapses onto the first import.
                </li>
                <li>
                  The bot reads public posts only: tags from a protected
                  account cannot import.
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="pb-20 text-center">
          <p className="text-[13px] text-neutral-400">
            See the result on{" "}
            <Link href="/map" className={TEXT_LINK}>
              the live map
            </Link>{" "}
            · Vidit is{" "}
            <a
              href="https://github.com/vidithq/vidit"
              target="_blank"
              rel="noopener noreferrer"
              className={TEXT_LINK}
            >
              open source
            </a>
          </p>
        </section>
      </PageFrame>
    </main>
  );
}

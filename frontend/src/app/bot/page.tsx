import type { Metadata } from "next";
import Link from "next/link";
import { AtSign, Reply, ShieldCheck, ClipboardCheck } from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
import { Pill } from "@/components/ui/Pill";
import { Dot } from "@/components/ui/Dot";
import { PageFrame } from "@/components/ui/PageFrame";

// Public guide for the @ViditBot mention format, reachable without an
// account (see `PUBLIC_PREFIXES` in `proxy.ts`). This is the page the bot's
// bio and pinned post point to, and the destination behind the failure
// reply's "Guide in bio": the reply itself is linkless by contract, so the
// full lesson lives here. Server component for SEO, composed from the same
// primitives and section/card markup as the landing page.

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

// The three marker lines, the whole vocabulary the bot reads.
const MARKERS: { marker: string; label: string; body: string }[] = [
  {
    marker: "T:",
    label: "Title",
    body: "The event title, on its own line.",
  },
  {
    marker: "C:",
    label: "Coordinates",
    body: "One decimal pair (48.123456, 37.654321) and nothing else on the line. Signs and degree symbols are fine; DMS is not.",
  },
  {
    marker: "S:",
    label: "Source",
    body: "Exactly one link, to the post carrying the footage. Never your own post, and never two links on the line.",
  },
];

// A mock post: the landing's card shell around a monospace body, an
// author line, and an optional attachment hint. Content-only markup, same
// composition vocabulary as the landing's feature cards.
function ExamplePost({
  attachment,
  children,
}: {
  attachment?: string;
  children: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <p className="text-[11px] font-medium text-neutral-500">
        @you <span className="font-normal text-neutral-600">on X</span>
      </p>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-neutral-300">
        {children}
      </pre>
      {attachment && (
        <p className="mt-2 text-[11px] text-neutral-500">📎 {attachment}</p>
      )}
    </div>
  );
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
            {MARKERS.map(({ marker, label, body }) => (
              <div
                key={marker}
                className="rounded-lg border border-neutral-800 bg-neutral-900 p-5"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-md border border-neutral-700 bg-neutral-800 font-mono text-sm text-orange-400">
                  {marker}
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
            Every other line of your post becomes the draft&apos;s proof note.
            Markers are case-insensitive; free-text coordinates are not parsed.
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
                One post carrying the tag and the three lines. When S: links an
                X post or a public Telegram post, Vidit fetches the footage and
                its post date for you. Quoting the source post instead of
                linking it works too. Attach your annotated screenshots: they
                land as proof.
              </p>
              <div className="mt-4">
                <ExamplePost attachment="your annotated screenshots (proof)">
                  {"@ViditBot\nT: Strike on the vehicle depot\nC: 48.123456, 37.654321\nS: https://x.com/warfootage/status/17…\nSmoke plume matches the skyline"}
                </ExamplePost>
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
                from those, so relay it yourself. Post the three lines first,
                then tag the bot in a direct reply to your own post, with the
                footage attached. The reply&apos;s media becomes the source
                footage; anything you write next to it joins the proof note.
              </p>
              <div className="mt-4 space-y-3">
                <ExamplePost attachment="your annotated screenshots (proof)">
                  {"T: Strike on the vehicle depot\nC: 48.123456, 37.654321\nS: https://www.tiktok.com/@war/video/7…\nSmoke plume matches the skyline"}
                </ExamplePost>
                <ExamplePost attachment="the re-uploaded footage (source)">
                  {"↳ replying to your own post\n@ViditBot"}
                </ExamplePost>
              </div>
            </div>
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
                  The bot replies in-thread with your draft&apos;s reference,
                  and flags a possible duplicate when the media is already on
                  Vidit.
                </li>
                <li>
                  The draft waits in your profile&apos;s detections queue.
                  Review it, fix the event date (the post date is only a
                  proxy), then publish.
                </li>
                <li>
                  If the format is incomplete, the bot replies with what is
                  missing. Tag again on a corrected post.
                </li>
              </ul>
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
                  S: holds exactly one link, to the footage post, never your
                  own post.
                </li>
                <li>
                  A relay reply must answer your own marker post; tags under
                  someone else&apos;s post import nothing.
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

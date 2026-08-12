import type { Metadata } from "next";
import Link from "next/link";
import {
  Globe,
  AtSign,
  Import,
  Crosshair,
  Archive,
  Code,
  Play,
} from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
import { Pill } from "@/components/ui/Pill";
import { PageFrame } from "@/components/ui/PageFrame";
import HeroCtas from "@/components/landing/HeroCtas";
import DemoVideo from "@/components/landing/DemoVideo";

// Public landing at `vidit.app`, reachable without an account (see
// `PUBLIC_EXACT` in `proxy.ts`); the app lives behind login at `/map`.
// Server component for SEO (no "use client"); the hero CTAs are a small
// `<HeroCtas>` client island that swaps sign-in for "Open the map" once
// signed in. Offset by `pl-14` to keep the shared sidebar rail.

// `openGraph` + `twitter` blocks render a rich summary_large_image card
// instead of a bare text card. The image comes from the sibling
// `opengraph-image.tsx` / `twitter-image.tsx` route files.
export const metadata: Metadata = {
  title: "Vidit: archive and map conflict geolocations",
  description:
    "An open-source, professional platform for OSINT/GEOINT analysts to archive, reference, and visualise geolocations of armed-conflict events.",
  openGraph: {
    type: "website",
    url: "https://vidit.app",
    siteName: "Vidit",
    title: "Vidit: archive and map conflict geolocations",
    description:
      "An open-source, professional platform for OSINT/GEOINT analysts to archive, reference, and visualise geolocations of armed-conflict events.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@vidithq",
    creator: "@vidithq",
    title: "Vidit: archive and map conflict geolocations",
    description:
      "An open-source, professional platform for OSINT/GEOINT analysts to archive, reference, and visualise geolocations of armed-conflict events.",
  },
};

// Set NEXT_PUBLIC_DEMO_VIDEO_URL to an embed URL or a direct .mp4 to light
// up the player (placeholder until then), so the video ships without a
// code change.
const DEMO_VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL;
// A self-hosted file plays in a native <video>; an embed URL needs an
// <iframe>. Pick the element by file extension.
const DEMO_VIDEO_IS_FILE =
  !!DEMO_VIDEO_URL && /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(DEMO_VIDEO_URL);

// Icons reuse the product's vocabulary: `Globe` echoes the map,
// `AtSign`/`Import` the two on-ramp channels, `Crosshair` the proof.
const FEATURES: {
  icon: typeof Globe;
  title: string;
  body: string;
}[] = [
  {
    icon: Globe,
    title: "One interactive map",
    body: "Every geolocation the community submits, on one map you can filter by conflict, capture source, date, or analyst.",
  },
  {
    icon: Crosshair,
    title: "Proof, not just a pin",
    body: "Each geolocation carries its argument: the source media next to the satellite view, annotated anchors, coordinates, event date, and capture source.",
  },
  {
    icon: Import,
    title: "Your history, imported in one step",
    body: "Upload your official X archive and every geolocation you've already published is backfilled as drafts you review and vouch for. No manual re-entry.",
  },
  {
    icon: AtSign,
    title: "Tag @ViditBot, it's archived",
    body: "Tag @ViditBot under a geolocation post on X and it lands here as a structured draft, with an in-thread reply telling you what was captured. You never leave your workflow.",
  },
  {
    icon: Archive,
    title: "Your work outlives its source",
    body: "Every image and video is copied to Vidit's own storage as a permanent, locked record, so it survives even when the original is deleted, the channel vanishes, or an account is banned.",
  },
  {
    icon: Code,
    title: "Open source, end to end",
    body: "The entire platform is AGPL-3.0 on GitHub: auditable, forkable, self-hostable. Infrastructure the community can trust because it can read it.",
  },
];

const GITHUB_URL = "https://github.com/vidithq/vidit";

// Reader-facing roadmap, the public projection of `planning/roadmap.md`.
// Current + upcoming only; shipped history lives in the CHANGELOG. `state`
// drives the treatment: the current version carries the accent card and pill.
// Optional `link` surfaces an in-card link to a concrete artifact.
type RoadmapState = "current" | "upcoming";

const ROADMAP: {
  version: string;
  state: RoadmapState;
  title: string;
  body: string;
  link?: { href: string; label: string };
}[] = [
  {
    version: "v0.5",
    state: "current",
    title: "Analyst portfolio",
    body: "Your body of work becomes a first-class object: a public profile that reads as a portfolio, rich link previews wherever you share it, batch completion of imported drafts, a mobile pass on the pages readers land on, and sources archived when you publish so the work outlives its tweets.",
  },
  {
    version: "v0.6",
    state: "upcoming",
    title: "Collaboration & reviews",
    body: "Notifications, shared credit on events, edit history on published geolocations, and the request board as a shared queue. Organisations get a verified profile with members and roles, and an analyst or an organisation can approve a geolocation at a given revision.",
  },
  {
    version: "v1.0",
    state: "upcoming",
    title: "Public v1",
    body: "Open self-registration behind a hardened moderation and legal stack, map density, and the closed-beta framing removed. The full release.",
  },
];

export default function LandingPage() {
  return (
    <main className="bg-neutral-950 text-neutral-100">
      {/* The shared PageFrame puts the landing's content at the same left inset
          and column as every app page; each section adds only its own vertical
          rhythm. */}
      <PageFrame>
        <section className="pt-16 pb-12 text-center">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1]">
            The home for conflict geolocations
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-neutral-400 leading-relaxed">
            Vidit is an{" "}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={TEXT_LINK}
            >
              open-source
            </a>
            , professional platform for OSINT/GEOINT analysts to archive,
            reference, and visualise geolocations of armed-conflict events.
          </p>
          <HeroCtas />
        </section>

        <section className="pb-20">
          <div className="aspect-video w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            {DEMO_VIDEO_URL ? (
              DEMO_VIDEO_IS_FILE ? (
                <DemoVideo src={DEMO_VIDEO_URL} />
              ) : (
                <iframe
                  src={DEMO_VIDEO_URL}
                  title="Vidit product demo"
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              )
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
                <span className="size-12 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-400">
                  <Play size={18} />
                </span>
                <p className="text-sm text-neutral-400">Product demo</p>
                <p className="text-xs text-neutral-600">
                  A short walkthrough: map to geolocation to submission. Coming
                  soon.
                </p>
                {/* Placeholder-only: while there is no video, the written
                    guide covers the same ground. When a video ships, how the
                    two pair gets decided then. */}
                <p className="text-xs text-neutral-600">
                  In the meantime, read{" "}
                  <Link href="/guide" className={TEXT_LINK}>
                    how Vidit works
                  </Link>
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="pb-20">
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-lg border border-neutral-800 bg-neutral-900 p-5"
              >
                <span className="size-9 rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center text-orange-400">
                  <Icon size={17} />
                </span>
                <h3 className="mt-4 text-sm font-medium text-neutral-100">
                  {title}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-400">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="pb-20">
          <div className="text-center">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-200">
              Roadmap
            </h2>
          </div>
          <ol className="mt-6 space-y-3">
            {ROADMAP.map(({ version, state, title, body, link }) => (
              <li
                key={title}
                className={`flex gap-4 rounded-lg border p-4 ${
                  state === "current"
                    ? "border-orange-500/40 bg-orange-500/4"
                    : "border-neutral-800 bg-neutral-900"
                }`}
              >
                <Pill
                  tone={state === "current" ? "accent" : "neutral"}
                  className="self-start font-mono"
                >
                  {version}
                </Pill>
                <div>
                  <h3 className="text-sm font-medium text-neutral-100">
                    {title}
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-neutral-400">
                    {body}
                  </p>
                  {link && (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-2 inline-block text-[13px] ${TEXT_LINK}`}
                    >
                      {link.label} →
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </PageFrame>
    </main>
  );
}

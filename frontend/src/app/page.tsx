import type { Metadata } from "next";
import Link from "next/link";
import {
  Globe,
  AtSign,
  Import,
  Crosshair,
  Archive,
  Code,
  BookOpen,
  IdCard,
  Play,
  ArrowRight,
} from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { Pill } from "@/components/ui/Pill";
import { PageFrame } from "@/components/ui/PageFrame";
import { buttonClasses } from "@/components/ui/Button";
import DemoVideo from "@/components/landing/DemoVideo";
import { staticPageMetadata } from "./_og/metadata";

// Public landing at `vidit.app`, reachable without an account (see
// `PUBLIC_EXACT` in `proxy.ts`); the app lives behind login at `/map`.
// Server component for SEO (no "use client"); the hero CTA is a plain link,
// the same one for every visitor. `PageFrame` offsets it by `sm:pl-14` to keep
// the shared sidebar rail, which is a fixed column from `sm` up and a drawer
// below, where the page takes no left inset at all.

// `openGraph` + `twitter` blocks render a rich summary_large_image card
// instead of a bare text card. The image comes from the sibling
// `opengraph-image.tsx` / `twitter-image.tsx` route files.
export const metadata: Metadata = staticPageMetadata({
  path: "/",
  title: "Vidit: archive and map conflict geolocations",
  description:
    "Vidit is the open source platform where OSINT/GEOINT analysts publish, archive and share geolocated events from armed conflicts.",
});

// Set NEXT_PUBLIC_DEMO_VIDEO_URL to an embed URL or a direct .mp4 to light
// up the player (placeholder until then), so the video ships without a
// code change.
const DEMO_VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL;
// A self-hosted file plays in a native <video>; an embed URL needs an
// <iframe>. Pick the element by file extension.
const DEMO_VIDEO_IS_FILE =
  !!DEMO_VIDEO_URL && /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(DEMO_VIDEO_URL);

// Features are grouped by who they are for, and the page renders one titled
// grid per group in this order. Icons reuse the product's vocabulary: `Globe`
// echoes the map, `AtSign`/`Import` the two on-ramp channels, `Crosshair` the
// proof.
const FEATURE_GROUPS: {
  audience: string;
  features: { icon: typeof Globe; title: string; body: string }[];
}[] = [
  {
    audience: "For everyone",
    features: [
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
        icon: Code,
        title: "Open source, end to end",
        body: "The entire platform is AGPL-3.0 on GitHub: auditable, forkable, self-hostable. Infrastructure the community can trust because it can read it.",
      },
      {
        icon: BookOpen,
        title: "Open to read, no account",
        body: "The map, every event page and every profile are public. No account and no paywall: the record is there to be read.",
      },
    ],
  },
  {
    audience: "For analysts",
    features: [
      {
        icon: Import,
        title: "Your history, imported in one step",
        body: "Upload your official X archive and every geolocation you've already published is backfilled as detections you review and vouch for. No manual re-entry.",
      },
      {
        icon: AtSign,
        title: "Tag @ViditBot, it's archived",
        body: "Tag @ViditBot under a geolocation post on X and it lands here as a structured detection, with an in-thread reply telling you what was captured. You never leave your workflow.",
      },
      {
        icon: Archive,
        title: "Your work outlives its source",
        body: "Every image and video is copied to Vidit's own storage as a permanent, locked record, so it survives even when the original is deleted, the channel vanishes, or an account is banned.",
      },
      {
        icon: IdCard,
        title: "A portfolio that speaks for you",
        body: "Your public profile reads as a portfolio: your insights, a coverage map of your geolocations, and rich link previews wherever you share it.",
      },
    ],
  },
];

const GITHUB_URL = "https://github.com/vidithq/vidit";

// Reader-facing roadmap. Mirrors the issues of type Epic in the GitHub Project
// (https://github.com/orgs/vidithq/projects/1); change both.
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
    version: "v0.8",
    state: "current",
    title: "Cleanup & restructuring",
    body: "One release of consolidation before moderation and the public launch: duplicated sources of truth merge, the sign-in layer and file storage are restructured, and tests, docs and backups harden. No new feature for analysts.",
  },
  {
    version: "v0.9",
    state: "upcoming",
    title: "Moderation",
    body: "Reports filed in the product feed an admin moderation queue. Uploads are scanned for graphic content and child sexual abuse material, metadata is stripped, and a public content policy spells out the rules.",
  },
  {
    version: "v0.10",
    state: "upcoming",
    title: "Search & discovery",
    body: "A geolocation can cover several subject points. Search reaches proof text and source URLs, and the platform surfaces related events and near-duplicates.",
  },
  {
    version: "v1.0",
    state: "upcoming",
    title: "Public v1",
    body: "Anyone can create a reader account to follow analysts and get notifications. Publishing stays with contributors, who earn the status through a verified X handle reviewed by an admin or through sponsorship by another contributor. Anti-abuse, hardened sign-in and a legal foundation back the launch, and the beta framing is removed.",
  },
];

export default function LandingPage() {
  return (
    <main className="bg-neutral-950 text-neutral-100">
      {/* PageFrame aligns the landing with every app page; sections add only vertical rhythm. */}
      <PageFrame>
        <section className="pt-16 pb-12 text-center">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1]">
            The home for conflict geolocations
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-neutral-400 leading-relaxed">
            Vidit is the{" "}
            <OutboundLink
              href={GITHUB_URL}
              className={TEXT_LINK}
            >
              open source
            </OutboundLink>{" "}
            platform where OSINT/GEOINT analysts publish, archive and share
            geolocated events from armed conflicts.
          </p>
          {/* The hero carries the read path alone; joining lives in the sidebar's sign-in. */}
          <div className="mt-8 flex items-center justify-center">
            <Link href="/map" className={buttonClasses("primary")}>
              Explore the map
              <ArrowRight size={15} />
            </Link>
          </div>
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
              /* Fallback when `DEMO_VIDEO_URL` is unset (local dev or a misconfigured deploy). */
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
                <span className="size-12 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-400">
                  <Play size={18} />
                </span>
                <p className="text-sm text-neutral-400">Product demo</p>
              </div>
            )}
          </div>
        </section>

        {FEATURE_GROUPS.map(({ audience, features }) => (
          <section key={audience} className="pb-20">
            <div className="text-center">
              <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-200">
                {audience}
              </h2>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {features.map(({ icon: Icon, title, body }) => (
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
        ))}

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
                    <OutboundLink
                      href={link.href}
                      className={`mt-2 inline-block text-[13px] ${TEXT_LINK}`}
                    >
                      {link.label} →
                    </OutboundLink>
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

import type { Metadata } from "next";
import { Globe, Target, Import, Tags, Archive, Filter, Play } from "lucide-react";
import { BETA_PILL, FILTER_CHIP_ACTIVE } from "@/components/ui/styles";
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
    "An open, professional platform for OSINT/GEOINT analysts to archive, reference, and visualise geolocations of armed-conflict events. In closed beta.",
  openGraph: {
    type: "website",
    url: "https://vidit.app",
    siteName: "Vidit",
    title: "Vidit: archive and map conflict geolocations",
    description:
      "An open, professional platform for OSINT/GEOINT analysts to archive, reference, and visualise geolocations of armed-conflict events.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@vidithq",
    creator: "@vidithq",
    title: "Vidit: archive and map conflict geolocations",
    description:
      "An open, professional platform for OSINT/GEOINT analysts to archive, reference, and visualise geolocations of armed-conflict events.",
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

// Icons reuse the product's vocabulary: `Globe`/`Target`/`Filter` echo
// Map, Bounties, and the trust mark elsewhere in the app.
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
    icon: Target,
    title: "Bounties for the community",
    body: "Post a bounty to point the community at an event that needs geolocating, and steer effort where it matters.",
  },
  {
    icon: Import,
    title: "Import straight from a tweet",
    body: "Paste a tweet URL and the form pre-fills itself: title, source, date, media, even coordinates.",
  },
  {
    icon: Tags,
    title: "Structured, not a caption",
    body: "Every geolocation is structured data you can filter the catalogue by: coordinates, event date, source, conflict, and capture source.",
  },
  {
    icon: Archive,
    title: "Your work outlives its source",
    body: "Every image and video is copied to Vidit's own storage as a permanent, locked record, so it survives even when the original is deleted, the channel vanishes, or an account is banned.",
  },
  {
    icon: Filter,
    title: "A trust filter, never a gate",
    body: "Any registered analyst can submit. A visible trust mark flags known-credible analysts, and readers can filter to vetted-only: a quality signal, never a barrier.",
  },
];

const GITHUB_URL = "https://github.com/vidithq/vidit";

// Reader-facing roadmap. Optional `link` surfaces an in-card link to a
// concrete artifact (e.g. the repo for "Open source launch").
const ROADMAP: {
  version: string;
  current: boolean;
  title: string;
  body: string;
  link?: { href: string; label: string };
}[] = [
  {
    version: "v0.3",
    current: true,
    title: "Open source launch",
    body: "Vidit is open source under AGPL-3.0 — the clearest answer to “closed / unknown tool”.",
    link: { href: GITHUB_URL, label: "View on GitHub" },
  },
  {
    version: "v0.4",
    current: false,
    title: "Curated onboarding",
    body: "Read opens to everyone — the map and the archive go public. Analysts join by claiming a profile assembled from their own public geolocations on X, with no manual re-entry.",
  },
  {
    version: "v0.5",
    current: false,
    title: "Open beta",
    body: "Open self-registration: the invite-code gate comes down, behind a hardened moderation and legal stack.",
  },
  {
    version: "v1.0",
    current: false,
    title: "Public v1",
    body: "Catalogue density, deeper search and social features, and the closed-beta framing removed. The full release.",
  },
];

export default function LandingPage() {
  return (
    <main className="bg-[#0a0a0a] text-neutral-100">
      {/* The shared PageFrame puts the landing's content at the same left inset
          and column as every app page; each section adds only its own vertical
          rhythm. */}
      <PageFrame>
        <section className="pt-16 pb-12 text-center">
          <div
            className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-medium tracking-tight ${BETA_PILL}`}
          >
            <span className="size-1.5 rounded-full bg-orange-500" />
            <span>Closed beta · invite-only</span>
          </div>
          <h1 className="mt-6 text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1]">
            The home for conflict geolocations
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-neutral-400 leading-relaxed">
            Vidit is an open, professional platform for OSINT/GEOINT analysts to
            archive, reference, and visualise geolocations of armed-conflict
            events.
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
            {ROADMAP.map(({ version, current, title, body, link }) => (
              <li
                key={title}
                className={`flex gap-4 rounded-lg border p-4 ${
                  current
                    ? "border-orange-500/40 bg-orange-500/4"
                    : "border-neutral-800 bg-neutral-900"
                }`}
              >
                <span
                  className={`shrink-0 self-start px-2 py-0.5 rounded-full font-mono text-[11px] font-medium ${
                    current ? FILTER_CHIP_ACTIVE : "bg-neutral-800 text-neutral-500"
                  }`}
                >
                  {version}
                </span>
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
                      className="mt-2 inline-block text-[13px] text-orange-400 hover:text-orange-300"
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

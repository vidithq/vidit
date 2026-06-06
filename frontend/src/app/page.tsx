import type { Metadata } from "next";
import { Globe, Target, Import, Tags, Archive, Filter, Play } from "lucide-react";
import { BETA_PILL, FILTER_CHIP_ACTIVE } from "@/components/ui/styles";
import HeroCtas from "@/components/landing/HeroCtas";

// Public landing page — the storefront at `vidit.app`. Reachable without
// an account (see `PUBLIC_EXACT` in `middleware.ts`): pitch + about video +
// public roadmap, so a skeptical analyst can evaluate Vidit before
// committing to an invite. The app itself lives behind login at `/map`.
//
// Opts out of `PageShell` (in-app chrome) but keeps the shared sidebar
// rail (content offset by `pl-14`). A server component (no "use client")
// for SEO; the hero CTAs are a small `<HeroCtas>` client island that swaps
// Sign-in / invite for "Open the map" once the visitor is signed in.

export const metadata: Metadata = {
  title: "Vidit: archive and map conflict geolocations",
  description:
    "An open, professional platform for OSINT/GEOINT analysts to archive, reference, and visualise geolocations of armed-conflict events. In closed beta.",
};

// Set NEXT_PUBLIC_DEMO_VIDEO_URL to a YouTube/Vimeo *embed* URL (or a
// direct .mp4) to light up the demo player; until then the slot renders a
// placeholder. Lets the about video ship without a code change.
const DEMO_VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL;
// A self-hosted file (our CloudFront .mp4) plays in a native <video>; a
// YouTube/Vimeo *embed* URL needs an <iframe>. Pick the element by file
// extension so both keep working.
const DEMO_VIDEO_IS_FILE =
  !!DEMO_VIDEO_URL && /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(DEMO_VIDEO_URL);

// The six features worth pushing, on a uniform 2×3 grid. Icons reuse the
// product's own vocabulary: `Globe`/`Target`/`Filter` echo Map, Bounties,
// and the trust mark elsewhere in the app.
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

// Reader-facing roadmap. Kept deliberately honest and high-level — the
// internal milestone detail lives in docs/next.md + docs/roadmap.md. Keep
// the `status` current as milestones land.
const ROADMAP = [
  {
    tag: "Now",
    current: true,
    title: "Visibility",
    body: "This page, an about video, and a public roadmap, so anyone can judge Vidit before signing up. First analyst invites going out.",
  },
  {
    tag: "Next",
    current: false,
    title: "Open source",
    body: "The analyst platform becomes open source: the clearest answer to “closed / unknown tool”, and a standing invitation to contribute.",
  },
  {
    tag: "Then",
    current: false,
    title: "Open beta",
    body: "Anonymous read and open self-registration: the invite-code gate comes down, behind a hardened safety and legal stack.",
  },
  {
    tag: "Later",
    current: false,
    title: "Public v1",
    body: "Catalogue density, deeper search and social features, and the closed-beta framing removed. The full release.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-neutral-100 pl-14">
      {/* Hero */}
      <section className="mx-auto max-w-3xl px-5 pt-16 pb-12 text-center">
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

      {/* About video */}
      <section className="mx-auto max-w-4xl px-5 pb-20">
        <div className="aspect-video w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
          {DEMO_VIDEO_URL ? (
            DEMO_VIDEO_IS_FILE ? (
              <video
                src={DEMO_VIDEO_URL}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full"
              >
                Your browser doesn&rsquo;t support embedded video.
              </video>
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

      {/* Features */}
      <section className="mx-auto max-w-4xl px-5 pb-20">
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

      {/* Public roadmap */}
      <section className="mx-auto max-w-3xl px-5 pb-20">
        <div className="text-center">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-200">
            Where we&apos;re going
          </h2>
        </div>
        <ol className="mt-6 space-y-3">
          {ROADMAP.map(({ tag, current, title, body }) => (
            <li
              key={title}
              className={`flex gap-4 rounded-lg border p-4 ${
                current
                  ? "border-orange-500/40 bg-orange-500/[0.04]"
                  : "border-neutral-800 bg-neutral-900"
              }`}
            >
              <span
                className={`shrink-0 self-start px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  current ? FILTER_CHIP_ACTIVE : "bg-neutral-800 text-neutral-500"
                }`}
              >
                {tag}
              </span>
              <div>
                <h3 className="text-sm font-medium text-neutral-100">{title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-neutral-400">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

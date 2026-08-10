import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { TEXT_LINK } from "@/components/ui/styles";

// Public methodology guide, reachable without an account (see
// `PUBLIC_PREFIXES` in `proxy.ts`). Linked from the proof section of the
// submit and edit forms, where the analyst needs it, and from the about
// page. Server component for SEO, composed from the same PageShell + Card
// primitives as the about page, whose Methodology section moved here.

const TITLE = "Building a proof";
const DESCRIPTION =
  "How a Vidit geolocation proof comes together: verify and archive the source, pin the visual anchors, cross-reference on satellite imagery, and annotate the match.";

// Same openGraph + twitter shape as the landing so a shared link reads as
// Vidit, not a bare title. The shared `opengraph-image.tsx` /
// `twitter-image.tsx` at the app root supply the image without per-page
// binary assets.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "https://vidit.app/methodology",
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

const PROOF_STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Verify and archive the source",
    body: (
      <>
        Reverse-image-search the source to rule out recycled footage from
        another conflict, and snapshot the link on{" "}
        <a
          href="https://archive.today"
          target="_blank"
          rel="noopener noreferrer"
          className={TEXT_LINK}
        >
          archive.today
        </a>{" "}
        so it survives if the original gets deleted.
      </>
    ),
  },
  {
    title: "Pin the visual anchors",
    body: "Pick three or more durable features in the source media: signage, road geometry, building footprints, infrastructure. Skip vehicles, smoke, or anything mobile.",
  },
  {
    title: "Cross-reference on satellite imagery",
    body: "Open the coordinates in Google Earth or Sentinel Hub. Confirm shape, scale, and relative position.",
  },
  {
    title: "Annotate the match",
    body: "On both images, draw matching coloured boxes around each anchor. Same colour for the same feature.",
  },
  {
    title: "Check the time-of-day",
    body: "Validate shadow direction and length against the timestamp. SunCalc takes 30 seconds.",
  },
  {
    title: "Optional: aerial alignment",
    body: "When the source is a drone or FPV clip, align camera trajectory and terrain profile to strengthen the match.",
  },
];

export default function MethodologyPage() {
  return (
    <PageShell
      title={TITLE}
    >
      <Card as="section">
        <p className="text-sm text-neutral-300 leading-relaxed">
          A geolocation proof is a visual argument: the source frame next to a
          satellite screenshot, with matching coloured boxes on the features
          that prove the match. Annotated anchors are what make a claim
          checkable: a reader can follow the same boxes across both images and
          reach the same conclusion, without taking your word for the
          coordinates. Six short steps:
        </p>
        <ol className="space-y-3 list-none">
          {PROOF_STEPS.map(({ title, body }, i) => (
            <li key={title} className="flex items-start gap-3">
              <span className="mt-0.5 size-6 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-[11px] text-neutral-400 font-medium shrink-0">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-100">{title}</p>
                <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

    </PageShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { NumberedSteps, type NumberedStep } from "@/components/ui/NumberedSteps";

// Public methodology guide, reachable without an account (see
// `PUBLIC_PREFIXES` in `proxy.ts`). Linked from the proof section of the
// submit and edit forms, where the analyst needs it, and from the about
// page. Server component for SEO, composed from the same PageShell + Card
// primitives as the about page.

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

const PROOF_STEPS: NumberedStep[] = [
  {
    title: "Verify and archive the source",
    body: "Reverse-image-search the source to rule out recycled footage from another conflict, then snapshot the link so it survives if the original gets deleted. The Archived copy field under Source URL opens a Wayback Machine page prefilled with the link you typed, and takes the snapshot back in the same field: a copy from web.archive.org, archive.ph or archive.today is stored under its own name.",
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
      back
      backFallback="/about"
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
        <NumberedSteps steps={PROOF_STEPS} />
      </Card>

    </PageShell>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { NumberedSteps, type NumberedStep } from "@/components/ui/NumberedSteps";
import { TEXT_LINK } from "@/components/ui/styles";
import { staticPageMetadata } from "../_og/metadata";

// Public methodology guide (see `PUBLIC_PREFIXES` in `proxy.ts`), linked from the proof section of the forms. Server component for SEO.
// The example's numbered discs are baked into the image and number the steps of the same index.

const TITLE = "Building a proof";
const DESCRIPTION =
  "How a Vidit geolocation proof comes together: verify and archive the source, pin the visual anchors, cross-reference on satellite imagery, and annotate the match.";

const EXAMPLE_EVENT = "/events/03bc6ca6-a5fb-489b-94fc-f100ef2aa88d";

// Same openGraph + twitter shape as the landing; the root image files supply the image.
export const metadata: Metadata = staticPageMetadata({
  path: "/methodology",
  title: TITLE,
  description: DESCRIPTION,
});

const PROOF_STEPS: NumberedStep[] = [
  {
    title: "Verify and archive the source",
    body: "Link the original post first, then each mirror of the same file, each with its post time (UTC) when known, never your own geolocation post. Reverse-image-search the file to rule out recycled footage, then archive each link: Archive beside a link opens the Wayback Machine with the link filled in and takes back its snapshot, or an archive.today (any mirror) or Ghostarchive copy.",
  },
  {
    title: "Pin the visual anchors",
    body: "Pick three or more fixed features (signage, road geometry, building footprints, infrastructure), never vehicles or smoke.",
  },
  {
    title: "Cross-reference on satellite imagery",
    body: "In Google Earth or Sentinel Hub, match shape, scale and relative position. On a satellite or aircraft source, link the provider's full permalink that reopens the same image at its capture date, not a short link, or archive the publication that shows it: the form names the provider, how to reopen the image and its credit.",
  },
  {
    title: "Annotate the match",
    body: "Box each anchor on both images, one colour per feature.",
  },
  {
    title: "Check the time of day",
    body: "Match shadow direction and length to the timestamp (SunCalc).",
  },
  {
    title: "Optional: aerial footage",
    body: "Match a drone or FPV clip's camera path and terrain.",
  },
];

export default function MethodologyPage() {
  return (
    <PageShell title={TITLE} back backFallback="/about">
      <Card as="section">
        <p className="text-sm text-neutral-300 leading-relaxed">
          A proof is a visual argument: the source frame next to satellite
          imagery, with matching coloured boxes on the features that prove the
          match. A reader follows the boxes across both images and reaches your
          conclusion without taking your word for the coordinates.
        </p>
        <figure className="space-y-2">
          <Image
            src="/methodology/proof-example.webp"
            alt="A proof image: a drone video frame of a checkpoint on the left, satellite imagery of the same road on the right, the checkpoint boxed in red on both, with numbered discs 1 to 4"
            width={2400}
            height={792}
            unoptimized
            className="h-auto w-full rounded-lg border border-neutral-800 bg-neutral-900"
          />
          <figcaption className="text-[13px] leading-relaxed text-neutral-400">
            Proof by AquilaTrenta for{" "}
            <Link href={EXAMPLE_EVENT} className={TEXT_LINK}>
              Destruction of the checkpoint at Vodyane
            </Link>
            . Each number on the image marks the step of the same number.
          </figcaption>
        </figure>
        <NumberedSteps steps={PROOF_STEPS} />
      </Card>
    </PageShell>
  );
}

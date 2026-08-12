import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Upload } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import {
  NumberedSteps,
  type NumberedStep,
} from "@/components/ui/NumberedSteps";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { MOCK_ANALYST, MockPost, MockPostLink } from "@/components/ui/MockPost";
import { TEXT_LINK } from "@/components/ui/styles";
import { MAX_UPLOAD_LABEL } from "@/lib/archive";
import { ARCHIVE_EXPORT_STEPS, X_ARCHIVE_HELP } from "@/lib/archiveExport";

// Public archive-import guide, reachable without an account (see
// `PUBLIC_PREFIXES` in `proxy.ts`). The reader-facing projection of the
// ingestion contract: `docs/ingestion.md` holds the mechanism, this page
// answers the two questions an analyst actually asks before uploading their
// whole posting history ("what do you read" and "what do I get back"). The
// second one is answered by showing a thread and the draft it becomes rather
// than by describing the resolution rules, which is why the page is short.
// Linked from the about page's Guides section, the getting-started guide, and
// the import panel itself. Server component for SEO, on the same PageShell +
// Card scaffolding as the other guides.

const TITLE = "Import your X archive";
const DESCRIPTION =
  "Upload your official X export and every geolocation you already published comes back as a draft to review: what the importer reads, what it skips, and what it never touches.";

// Same openGraph + twitter shape as the landing so a shared link reads as
// Vidit, not a bare title. The shared `opengraph-image.tsx` /
// `twitter-image.tsx` at the app root supply the image without per-page
// binary assets.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "https://vidit.app/archive",
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

// The four X-side steps are shared with the import panel; only the closing
// step differs, since a reader here has not opened the drop zone yet.
const STEPS: NumberedStep[] = [
  ...ARCHIVE_EXPORT_STEPS,
  {
    icon: Upload,
    title: "Upload it on Vidit",
    body: (
      <>
        Open{" "}
        <Link href="/submit?import=1" className={TEXT_LINK}>
          Submit
        </Link>{" "}
        and drop the zip on the archive panel. Your browser strips it first, so
        the upload is a fraction of the export.
      </>
    ),
  },
];

const SECTION = "text-sm font-medium text-neutral-200";
const BODY = "text-sm text-neutral-300 leading-relaxed";

export default function ArchiveGuidePage() {
  return (
    <PageShell title={TITLE}>
      <Card as="section">
        <p className={BODY}>
          An X export carries what the public API does not: your reply edges and
          the media files themselves. Upload it once and every geolocation in it
          comes back as a draft: on the map straight away, marked as a machine
          draft, credited to you. Reviewing one is yours alone: vouch for it and
          it becomes a geolocation, reject it and it comes down.
        </p>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>Getting the export</h2>
        <NumberedSteps steps={STEPS} />
        <p className="text-xs text-neutral-400 leading-relaxed">
          The stripped zip has to stay under {MAX_UPLOAD_LABEL}. If yours is
          bigger even after stripping, get in touch and we will find a way to
          import it.{" "}
          <a
            href={X_ARCHIVE_HELP}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1 ${TEXT_LINK}`}
          >
            {"X's own guide"}
            <ExternalLink size={12} strokeWidth={2} />
          </a>
        </p>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>What a thread becomes</h2>
        <p className={BODY}>
          A post becomes a draft when its text carries a coordinate. Self
          threads are stitched back together first, so footage in one post and
          the coordinate in another land as one geolocation, anchored on the
          earliest post.
        </p>
        <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
          <div className="space-y-3">
            <SectionEyebrow title="As you posted it" as="h3" margin="none" />
            <MockPost
              {...MOCK_ANALYST}
              media={{ kind: "image", label: "a photo you attached" }}
            >
              {"Bridge span dropped overnight\n49.842900, 24.031100\nSource: "}
              <MockPostLink>instagram.com/reel/DTN83</MockPostLink>
            </MockPost>
            <div className="pl-6">
              <MockPost
                {...MOCK_ANALYST}
                replyingTo={MOCK_ANALYST.handle}
                media={{ kind: "video", label: "the video you attached" }}
              >
                {"2/ Video"}
              </MockPost>
            </div>
          </div>
          <div className="space-y-3">
            <SectionEyebrow title="The draft you get" as="h3" margin="none" />
            <DetailCard>
              <DetailRow label="Title" value="Bridge span dropped overnight" />
              <DetailRow label="Coordinates" value="49.842900, 24.031100" />
              <DetailRow
                label="Source"
                value="instagram.com/reel/DTN83"
                align="start"
              />
              <DetailRow label="Footage" value="the video from post 2" />
              <DetailRow label="Proof" value="the photo, and your text" />
              <DetailRow label="Event date" value="the post date, to correct" />
            </DetailCard>
            <p className="text-[13px] leading-relaxed text-neutral-400">
              A video you attached is the footage. Photos stay in the proof,
              where annotated frames belong. A source Vidit can fetch (an X
              post, a public Telegram post) also brings back its own media and
              post date; anything else is kept as the link you wrote.
            </p>
          </div>
        </div>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>Before you upload</h2>
        <ul className="list-disc space-y-1.5 pl-4 text-sm text-neutral-300">
          <li>
            <span className="text-neutral-100">
              Two entries are read, and nothing else:
            </span>{" "}
            <span className="font-mono text-neutral-200">tweets.js</span> and
            the <span className="font-mono text-neutral-200">tweets_media</span>{" "}
            folder. Your browser rebuilds the zip down to those two before the
            upload starts, so the direct messages, email address, phone number
            and address book in the export never leave your device. The server
            keeps the same allowlist on its own side.
          </li>
          <li>
            <span className="text-neutral-100">
              Retweets are never imported.
            </span>{" "}
            A retweet carries someone else&apos;s post, and importing one would
            file their geolocation under your name.
          </li>
          <li>
            <span className="text-neutral-100">Re-uploading is safe.</span>{" "}
            Anything already imported is recognised and skipped, so an import
            that failed halfway is resumed by uploading the same file again.
          </li>
          <li>
            <span className="text-neutral-100">
              Drafts are partial by design.
            </span>{" "}
            They carry only what the post declared, and they read as machine
            drafts everywhere until you review them. You complete one at submit
            (the conflict, the capture source, the event date) and vouching for
            it is what makes it a geolocation under your name.
          </li>
        </ul>
        <p className={BODY}>
          New to the platform? The{" "}
          <Link href="/guide" className={TEXT_LINK}>
            getting-started guide
          </Link>{" "}
          covers the whole loop, and the{" "}
          <Link href="/bot" className={TEXT_LINK}>
            bot guide
          </Link>{" "}
          covers importing a single post by tagging @ViditBot on X.
        </p>
      </Card>
    </PageShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Upload } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import {
  NumberedSteps,
  type NumberedStep,
} from "@/components/ui/NumberedSteps";
import { TEXT_LINK } from "@/components/ui/styles";
import { MAX_UPLOAD_LABEL } from "@/lib/archive";
import { ARCHIVE_EXPORT_STEPS, X_ARCHIVE_HELP } from "@/lib/archiveExport";

// Public archive-import guide, reachable without an account (see
// `PUBLIC_PREFIXES` in `proxy.ts`). The reader-facing projection of the
// ingestion contract: `docs/ingestion.md` holds the mechanism, this page
// answers the two questions an analyst actually asks before uploading their
// whole posting history ("what do you read" and "what do I get back").
// Linked from the about page's Guides section, from the getting-started
// guide, and from the import panel itself. Server component for SEO,
// composed from the same PageShell + Card + NumberedSteps primitives as the
// other two guides.

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
        the upload is a fraction of the export and takes a fraction of the time.
      </>
    ),
  },
];

const HEADING = "text-sm font-medium text-neutral-200";
const BODY = "text-sm text-neutral-300 leading-relaxed";
const LIST = "mt-1.5 space-y-1.5 list-disc pl-4 text-sm text-neutral-300";

export default function ArchiveGuidePage() {
  return (
    <PageShell title={TITLE}>
      <Card as="section">
        <p className={BODY}>
          An X export carries something the public API does not: your reply
          edges and the media files themselves. That is what lets Vidit rebuild
          your threads and copy your footage into its own storage, so a
          geolocation you published years ago survives a deleted post. Upload
          the export once and every geolocation in it comes back as a draft you
          review and publish. Nothing is published in your name automatically.
        </p>
      </Card>

      <Card as="section">
        <h2 className={HEADING}>Getting the export</h2>
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
        <h2 className={HEADING}>What we read, and what we never touch</h2>
        <p className={BODY}>
          An X export is your whole account: direct messages, your email address
          and phone number, your address book, your ad profile. Vidit reads two
          entries out of it and nothing else:{" "}
          <span className="font-mono text-neutral-200">tweets.js</span> and the{" "}
          <span className="font-mono text-neutral-200">tweets_media</span>{" "}
          folder.
        </p>
        <ul className={LIST}>
          <li>
            Your browser rebuilds the zip down to those two entries{" "}
            <em>before</em> the upload starts, so the rest never leaves your
            device.
          </li>
          <li>
            The server keeps the same list on its own side. It is an allowlist,
            not a delete list: an entry nobody named is not read, whatever it is
            called.
          </li>
          <li>
            The staged upload is deleted as soon as the import reaches a result,
            whether it succeeded or failed.
          </li>
        </ul>
      </Card>

      <Card as="section">
        <h2 className={HEADING}>What becomes a draft</h2>
        <p className={BODY}>
          A post becomes a draft when its text carries a coordinate we can
          parse: a decimal pair, a hemisphere spelling, DMS, or a Google Maps
          link. Coordinates that live only inside an image are not read, which
          is the one real limit of the import.
        </p>
        <ul className={LIST}>
          <li>
            <span className="text-neutral-100">
              Retweets are never imported.
            </span>{" "}
            A retweet carries someone else&apos;s post, and importing one would
            file their geolocation under your name.
          </li>
          <li>
            <span className="text-neutral-100">Threads are recombined.</span>{" "}
            Your self-threads are stitched back together from the reply edges,
            so footage in the first post and the coordinate in a reply land as
            one geolocation rather than two halves. The earliest post anchors
            the draft: its title, its link back to X, and its date.
          </li>
          <li>
            <span className="text-neutral-100">
              Several coordinates, several drafts.
            </span>{" "}
            A post that places two sites produces one draft per coordinate.
          </li>
        </ul>
        <p className={BODY}>
          Drafts land partial on purpose. They wait in your detections queue
          carrying whatever the post actually declared, and you complete them at
          review: the conflict, the capture source, the event date, and anything
          the post left implicit.
        </p>
      </Card>

      <Card as="section">
        <h2 className={HEADING}>Where the source comes from</h2>
        <p className={BODY}>
          The source is the post the footage came from, and it is only ever
          filled from something you actually wrote. Vidit reads three signals,
          in order:
        </p>
        <ul className={LIST}>
          <li>
            <span className="text-neutral-100">A quoted post.</span> Quote the
            footage and the quoted post is the source, its date included.
          </li>
          <li>
            <span className="text-neutral-100">
              A line reading{" "}
              <span className="font-mono">Source: &lt;link&gt;</span>.
            </span>{" "}
            The link alone on its line, whatever the platform: Instagram,
            TikTok, a news article. One exception: an X link that points at a
            profile rather than a post names no footage, so it is not taken.
          </li>
          <li>
            <span className="text-neutral-100">
              A single footage link in the text.
            </span>{" "}
            With no quote and no Source line, one X post, Telegram post, or
            YouTube link in your text is read as the source. Several competing
            links leave the slot empty for you to settle at review.
          </li>
        </ul>
        <p className={BODY}>
          An X post or a public Telegram post is fetched for its date and its
          media. Any other platform is stored as a link: the source URL is kept,
          the footage is not fetched. A link back to one of your own posts is a
          cross-reference, never a source.
        </p>
      </Card>

      <Card as="section">
        <h2 className={HEADING}>What happens to your media</h2>
        <ul className={LIST}>
          <li>
            Media from a quoted post, or from a source we fetched, is the
            footage and lands as the draft&apos;s source media.
          </li>
          <li>
            When nothing else filled that slot, the first video you attached
            yourself becomes the source media. You filmed it or you re-uploaded
            it, so it is the footage.
          </li>
          <li>
            Photos you attached stay in the proof, where annotated frames and
            map crops belong. They are never promoted to source.
          </li>
        </ul>
        <p className={BODY}>
          Reference links in your text survive readable in the proof note:
          X&apos;s <span className="font-mono text-neutral-200">t.co</span>{" "}
          wrappers are expanded back to the real address, so a source line still
          reads as one after the import.
        </p>
      </Card>

      <Card as="section">
        <h2 className={HEADING}>Dates, and re-importing</h2>
        <ul className={LIST}>
          <li>
            The event date starts as the post date. It is a placeholder: an
            analyst usually posts after the event, so correct it at review
            before publishing.
          </li>
          <li>
            Re-uploading the same export creates no duplicates. Anything already
            imported is recognised and counted as skipped, so an import that
            failed halfway is resumed by uploading the same file again.
          </li>
          <li>
            The import runs on our side once the upload finishes. Close the page
            if you want: we email you the outcome, and the drafts appear in your
            queue as they are created.
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

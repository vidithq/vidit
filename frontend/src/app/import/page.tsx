import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Upload } from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import {
  NumberedSteps,
  type NumberedStep,
} from "@/components/ui/NumberedSteps";
import {
  MOCK_ANALYST,
  MOCK_BOT,
  MockPost,
  MockPostLink,
} from "@/components/ui/MockPost";
import { MAX_UPLOAD_LABEL } from "@/lib/archive";
import { ARCHIVE_EXPORT_STEPS, X_ARCHIVE_HELP } from "@/lib/archiveExport";

// The one analyst-facing import guide, reachable without an account (see
// `PUBLIC_PREFIXES` in `proxy.ts`). One detection engine reads every entry, so
// the rules are stated once under "What makes a draft" and each entry section
// holds only what differs. `docs/ingestion.md` holds the mechanism; this page
// is its reader-facing projection.
//
// Anchors are contract: `/bot` and `/archive` redirect to `#bot` and
// `#archive`, the bot's X bio points at `/bot`, and the import panels link to
// `#paste` and `#archive`. Keep the three heading ids.
//
// Server component for SEO, on the same PageShell + Card scaffolding as the
// other guides (`/guide`, `/methodology`).

const TITLE = "Import your work from X";
const DESCRIPTION =
  "Tag @ViditBot, paste a post URL, or upload your X archive. Vidit reads your posts and creates a draft for each geolocation, with its coordinates, source, media and proof note.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "https://vidit.app/import",
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

const SECTION = "text-sm font-medium text-neutral-200";
const BODY = "text-sm text-neutral-300 leading-relaxed";
const NOTE = "text-[13px] leading-relaxed text-neutral-400";
const LIST = `list-disc space-y-1 pl-4 ${NOTE}`;
const TILE = "rounded-lg border border-neutral-800 bg-neutral-900 p-4";
const TILE_TITLE = "text-sm font-medium text-neutral-100";

// The three rules that decide whether a post produces anything at all. Every
// entry applies them, so they read the same whichever way you import.
const RULES: { step: string; label: string; body: string }[] = [
  {
    step: "1",
    label: "A coordinate in your own text",
    body: "Your post, or another post of yours in the same thread, carries a coordinate anywhere in its text. A coordinate that lives only in a post you quote is that author's geolocation, not yours.",
  },
  {
    step: "2",
    label: "Your own post",
    body: "Every entry reads posts from the X handle linked to your Vidit account, and nothing else. A retweet produces nothing: its words belong to another account.",
  },
  {
    step: "3",
    label: "A source, if you have one",
    body: "A quote of the source post, or a single link, becomes the source. Several links leave the source empty and land as secondary links you pick from at review.",
  },
];

// The four X-side export steps are shared with the import panel on `/submit`;
// only the closing step differs, since a reader here has not opened the drop
// zone yet.
const EXPORT_STEPS: NumberedStep[] = [
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
        and drop the zip on the archive panel. Your browser strips the zip
        before uploading it, which reduces the upload size.
      </>
    ),
  },
];

export default function ImportGuidePage() {
  return (
    <PageShell title={TITLE} back backFallback="/about">
      <Card as="section">
        <p className={BODY}>
          Vidit reads the geolocations you already publish on X and creates a
          draft for each one, with its coordinates, source, media and proof
          note. There are three ways in and one engine behind them, so a post
          reads the same whichever you use. There is no format to learn: write
          your post as you always do.
        </p>
      </Card>

      <Card as="section">
        <h2 id="draft" className={SECTION}>
          What makes a draft
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {RULES.map(({ step, label, body }) => (
            <div key={step} className={TILE}>
              <span className="inline-flex size-9 items-center justify-center rounded-md border border-neutral-700 bg-neutral-800 font-mono text-sm text-orange-400">
                {step}
              </span>
              <h3 className={`mt-4 ${TILE_TITLE}`}>{label}</h3>
              <p className={`mt-1.5 ${NOTE}`}>{body}</p>
            </div>
          ))}
        </div>
        <ul className={LIST}>
          <li>
            <span className="text-neutral-100">Coordinate formats.</span>{" "}
            Decimal pairs (48.012345, 37.802411), decimal degrees with a
            hemisphere letter (33.1°N 35.5°E, N48.0123 E37.8024), DMS
            (48°00&apos;45&quot;N 37°48&apos;08&quot;E) and Google Maps
            @lat,lng links all read. Position does not matter: a coordinate
            inside a sentence reads like one alone on its line. Coordinates are
            read from text only, so one that appears only inside an image is
            not read.
          </li>
          <li>
            <span className="text-neutral-100">Source.</span> Every link your
            thread carries is a candidate, whatever the platform. Three are
            never candidates, because none points at footage: a link back to
            your own post, an X link naming no post, and a Google Maps link. A
            quote outranks links. One candidate becomes the source; several
            leave the source empty and all of them land as secondary links.
          </li>
          <li>
            <span className="text-neutral-100">Media.</span> A quoted
            post&apos;s media is the footage, then a chased Telegram
            post&apos;s, then your thread&apos;s first own video when the slot
            is still empty; your photos stay proof.
          </li>
          <li>
            <span className="text-neutral-100">Title.</span> The first line
            that carries text beyond coordinates and links, taken as written and
            cut at 120 characters. No line qualifying leaves the title empty,
            and you type one at review.
          </li>
          <li>
            <span className="text-neutral-100">Proof.</span> Your thread&apos;s
            text as you wrote it, coordinate line included, with each shortened
            link expanded back. You edit it at review.
          </li>
          <li>
            <span className="text-neutral-100">
              One draft per coordinate.
            </span>{" "}
            A post carrying several coordinates makes one draft each, sharing
            every other field.
          </li>
          <li>
            <span className="text-neutral-100">Importing twice.</span>{" "}
            Importing the same geolocation again reuses the first draft instead
            of duplicating it. A draft you already published or rejected stays
            as it is, so re-running an import is always safe.
          </li>
          <li>
            <span className="text-neutral-100">
              Nothing imports without a coordinate.
            </span>{" "}
            A post whose own text carries none, or whose coordinate sits
            outside the world, produces nothing.
          </li>
        </ul>
        <p className={NOTE}>
          A draft is on the map from the moment it lands, marked as a machine
          draft and attributed to your account, and it waits in your detections
          queue. Review it, correct the event date, then publish it as a
          geolocation. Rejecting it removes it. Only you turn your draft into a
          geolocation.
        </p>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>Three ways to import</h2>
        <p className={BODY}>
          The rules above hold for all three. What changes is where you work,
          how fast the draft appears, and how much of your history comes in at
          once.
        </p>
      </Card>

      <Card as="section">
        <h2 id="bot" className={SECTION}>
          Tag @ViditBot on X
        </h2>
        <p className={BODY}>
          Tag @ViditBot on a geolocation post and the draft appears on Vidit
          within seconds. You do not leave your feed and you retype nothing.
          The bot imports only for X handles linked to a Vidit account: it stays
          silent for any other handle and creates nothing. It reads public posts
          only, so a tag from a protected account imports nothing.
        </p>
        <div className="space-y-3">
          <div className={TILE}>
            <h3 className={TILE_TITLE}>One post carries everything</h3>
            <p className={`mt-1.5 mb-4 ${NOTE}`}>
              The coordinate, the source link and the tag on the same post.
            </p>
            <MockPost
              {...MOCK_ANALYST}
              media={{
                kind: "image",
                label: "your annotated screenshots (proof)",
              }}
            >
              {"Strike on the vehicle depot\n48.123456, 37.654321\n"}
              <MockPostLink>x.com/warfootage/status/1783</MockPostLink>
              {"\nSmoke plume matches the skyline.\n"}
              <MockPostLink>@viditbot</MockPostLink>
            </MockPost>
          </div>

          <div className={TILE}>
            <h3 className={TILE_TITLE}>Your post, then your own reply</h3>
            <p className={`mt-1.5 mb-4 ${NOTE}`}>
              Post the geolocation, then reply to yourself with the source and
              the tag. The bot reads both posts as one, and the draft is filed
              under the first of them, so tagging either one imports the same
              geolocation once. This is also how you import a post you published
              earlier.
            </p>
            <div className="space-y-3">
              <MockPost {...MOCK_ANALYST}>
                {
                  "Strike on the vehicle depot\n48.123456, 37.654321\nSmoke plume matches the skyline."
                }
              </MockPost>
              <div className="pl-6">
                <MockPost
                  {...MOCK_ANALYST}
                  replyingTo={MOCK_ANALYST.handle}
                  media={{
                    kind: "video",
                    label: "the re-uploaded footage (source)",
                  }}
                >
                  <MockPostLink>tiktok.com/@warfootage/video/7</MockPostLink>
                  {"\n"}
                  <MockPostLink>@viditbot</MockPostLink>
                </MockPost>
              </div>
            </div>
          </div>
        </div>
        <p className={NOTE}>
          The bot answers in-thread with your draft&apos;s reference and with
          what to fix at review: an empty source, several coordinates, a missing
          footage file or post date, or media already on Vidit. When nothing
          imports, it names which of the three refusals it was.
        </p>
        <div className="sm:max-w-md">
          <MockPost {...MOCK_BOT} replyingTo={MOCK_ANALYST.handle}>
            {
              "✅ 1 geolocation draft saved · ref 94183d44\nReview from your profile"
            }
          </MockPost>
        </div>
      </Card>

      <Card as="section">
        <h2 id="paste" className={SECTION}>
          Paste a post URL on Vidit
        </h2>
        <p className={BODY}>
          Open{" "}
          <Link href="/submit" className={TEXT_LINK}>
            Submit
          </Link>
          , pick <span className="text-neutral-100">From an X post</span> and
          paste the link to one of your own posts. The draft is created while
          you wait and the review opens on it. Your own posts only, matched
          against the X account linked to your profile; a third party&apos;s
          footage goes through the plain submit form with a source URL.
        </p>
        <p className={NOTE}>
          Warnings and refusals are shown on the page rather than on X, and
          nothing is posted under your handle, so this is the way in when you do
          not want a public trace. Pasting a post the bot already imported
          reopens that draft instead of making a second one.
        </p>
      </Card>

      <Card as="section">
        <h2 id="archive" className={SECTION}>
          Upload your X archive
        </h2>
        <p className={BODY}>
          Upload your official X export and every geolocation you already
          published comes back as a draft. This is the only entry that reads
          your whole history at once, and the only one that stitches full self
          threads, so a coordinate you posted three replies down still lands.
          Threads and media files import intact.
        </p>
        <NumberedSteps steps={EXPORT_STEPS} />
        <p className="text-xs leading-relaxed text-neutral-400">
          The stripped zip must stay under {MAX_UPLOAD_LABEL}. Contact us if
          yours is larger after stripping.{" "}
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
        <p className={NOTE}>
          An export runs as a background job, so you can close the page. Vidit
          emails you the outcome when it finishes: how many drafts were created,
          updated and skipped, and how many need a source or carry several
          coordinates. Uploading the same export again creates no duplicates,
          which is also how you resume an import that failed.
        </p>
      </Card>
    </PageShell>
  );
}

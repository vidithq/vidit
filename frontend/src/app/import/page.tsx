import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Upload } from "lucide-react";
import { TEXT_LINK } from "@/components/ui/styles";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { IconTile, TILE, TILE_TITLE } from "@/components/ui/IconTile";
import {
  NumberedSteps,
  STEP_NUMBER,
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
import { IMPORT_ENTRIES, IMPORT_GLYPH } from "@/lib/importEntries";
import { staticPageMetadata } from "../_og/metadata";
import { Shot } from "../_shots/Shot";

// The one import guide, public (see `PUBLIC_PREFIXES` in `proxy.ts`). One detection engine reads every entry, so the
// conditions are stated once under "What makes a detection" and each entry section holds only what differs. The
// detection lifecycle lives on `/guide#statuses`, the mechanism in `docs/ingestion.md`.
// Anchors are contract: `/bot` and `/archive` redirect to `#bot` and `#archive`, the import panels link to
// `#paste` and `#archive`, and `/guide` links `#detection` and the three entries. Keep the heading ids.

const TITLE = "Import your work from X";
const DESCRIPTION =
  "Tag @ViditBot, paste a post URL, or upload your X archive. Vidit reads your posts and creates a detection for each geolocation, with its coordinates, source, media and proof.";

export const metadata: Metadata = staticPageMetadata({
  path: "/import",
  title: TITLE,
  description: DESCRIPTION,
});

const SECTION = "text-sm font-medium text-neutral-200";
const BODY = "text-sm text-neutral-300 leading-relaxed";
const NOTE = "text-[13px] leading-relaxed text-neutral-400";
const LIST = `list-disc space-y-1 pl-4 ${NOTE}`;

const CARRIES: NumberedStep[] = [
  { title: "Coordinates, in any usual format." },
  { title: "Source: the post you quote, or a single link." },
  { title: "Source media: the footage in the quoted post." },
  { title: "Title: the first line with more than coordinates and links." },
  { title: "Proof: your text as written, and your photos as proof images." },
];

function Marked({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="flex items-start gap-2">
      <span className={STEP_NUMBER}>{n}</span>
      <span className="min-w-0">{children}</span>
    </span>
  );
}

// The X-side export steps are shared with the import panel on `/submit`; only the closing step differs.
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

// Section heading with its entry's glyph, matching the chooser tile.
const ENTRY_HEADING = `inline-flex items-center gap-1.5 ${SECTION}`;

export default function ImportGuidePage() {
  return (
    <PageShell title={TITLE} back backFallback="/about">
      <Card as="section">
        <p className={BODY}>
          Vidit reads the geolocations you already publish on X and creates a
          detection for each one. There are three ways in and one engine behind
          them, so a post reads the same whichever you use. There is no format
          to learn: write your post as you always do.
        </p>
        <h2 id="detection" className={SECTION}>
          What makes a detection
        </h2>
        <p className={BODY}>
          Two conditions, the same for every entry. The post is yours: it comes
          from the X handle linked to your Vidit account, and a retweet does not
          count. It carries a coordinate: anywhere in its text, or in the text
          of your own post it directly replies to. A coordinate that appears
          only in a post you quote does not count. One exception reads further:
          a reply that says nothing but @ViditBot points at the thread above it,
          so the bot climbs your own posts, up to three, until it finds the one
          carrying the coordinate.
        </p>
        <h2 className={SECTION}>What the detection carries</h2>
        <figure className="grid items-start gap-4 sm:grid-cols-2">
          <MockPost
            {...MOCK_ANALYST}
            quoted={{
              handle: "@frontlinefootage",
              text: <Marked n={2}>Drone strike on a vehicle depot</Marked>,
              media: { kind: "video", label: <Marked n={3}>the footage</Marked> },
            }}
          >
            <Marked n={1}>48.123456, 37.654321</Marked>
            <Marked n={4}>Strike on the vehicle depot</Marked>
            <Marked n={5}>The hangar roof and the tree line match the footage.</Marked>
          </MockPost>
          <figcaption>
            <NumberedSteps steps={CARRIES} />
          </figcaption>
        </figure>
        <h3 className={SECTION}>If a detection looks wrong</h3>
        <ul className={LIST}>
          <li>
            <span className="text-neutral-100">Coordinates:</span> decimal
            pairs (48.012345, 37.802411), a hemisphere letter (33.1°N 35.5°E,
            N48.0123 E37.8024), DMS (48°00&apos;45&quot;N 37°48&apos;08&quot;E)
            or a Google Maps @lat,lng link. Text inside an image is not read.
          </li>
          <li>
            <span className="text-neutral-100">Source:</span> a quote outranks
            links. A link to your own post, an X link naming no post and a
            Google Maps link never count. Several candidate links leave the
            source empty, and you pick one at review.
          </li>
          <li>
            <span className="text-neutral-100">Media:</span> with no quote, the
            source post&apos;s media fills the slot, then your thread&apos;s
            first own video.
          </li>
          <li>
            <span className="text-neutral-100">Title:</span> cut at 120
            characters. With no qualifying line, you type one at review.
          </li>
          <li>
            <span className="text-neutral-100">Proof:</span> shortened links are
            expanded back, and you edit the text at review.
          </li>
        </ul>
        <p className={NOTE}>
          A detection then follows the{" "}
          <Link href="/guide#statuses" className={TEXT_LINK}>
            path from detection to geolocation
          </Link>
          . A post carrying several coordinates makes one detection each,
          sharing every other field. Importing the same geolocation again reuses
          the first detection, and one you already published or rejected stays
          as it is, so re-running an import is always safe.
        </p>
        <h2 className={SECTION}>Three ways in</h2>
        <Shot page="import" id="submit-modes">
          <p className={NOTE}>Tagging @ViditBot needs no form: you tag it on X.</p>
        </Shot>
        <div className="grid gap-4 sm:grid-cols-3">
          {IMPORT_ENTRIES.map(({ anchor, title, when }) => (
            <IconTile
              key={anchor}
              href={`#${anchor}`}
              icon={IMPORT_GLYPH[anchor]}
              title={title}
              note={when}
            />
          ))}
        </div>
      </Card>

      <Card as="section">
        <h2 id="archive" className={ENTRY_HEADING}>
          {IMPORT_GLYPH.archive}
          Upload your X archive
        </h2>
        <p className={BODY}>
          Upload your official X export and every geolocation you already
          published comes back as a detection. This is the only entry that reads
          your whole history at once, and the only entry that stitches full self
          threads, so a coordinate you posted three replies down still lands
          beside the source you posted at the top.
        </p>
        <NumberedSteps steps={EXPORT_STEPS} />
        <p className="text-xs leading-relaxed text-neutral-400">
          The stripped zip must stay under {MAX_UPLOAD_LABEL}. Contact us if
          yours is larger after stripping.{" "}
          <OutboundLink
            href={X_ARCHIVE_HELP}
            className={`inline-flex items-center gap-1 ${TEXT_LINK}`}
          >
            {"X's own guide"}
            <ExternalLink size={12} strokeWidth={2} />
          </OutboundLink>
        </p>
        <p className={NOTE}>
          An export runs as a background job, so you can close the page. Vidit
          emails you the outcome when it finishes: how many detections were
          created, updated and skipped, and how many need a source or carry
          several coordinates. To resume an import that failed, upload the same
          export again.
        </p>
      </Card>

      <Card as="section">
        <h2 id="paste" className={ENTRY_HEADING}>
          {IMPORT_GLYPH.paste}
          Paste a post URL on Vidit
        </h2>
        <p className={BODY}>
          Open{" "}
          <Link href="/submit" className={TEXT_LINK}>
            Submit
          </Link>
          , pick <span className="text-neutral-100">From an X post</span> and
          paste the link to one of your own posts. The detection is created
          while you wait; the review opens on it when nothing needs your
          attention, otherwise the page tells you what does. For a third
          party&apos;s footage, use the plain submit form with a source URL.
        </p>
        <p className={NOTE}>
          Warnings and refusals are shown on the page rather than on X, and
          nothing is posted under your handle, so this is the way in when you do
          not want a public trace.
        </p>
      </Card>

      <Card as="section">
        <h2 id="bot" className={ENTRY_HEADING}>
          {IMPORT_GLYPH.bot}
          Tag @ViditBot on X
        </h2>
        <p className={BODY}>
          Tag @ViditBot on a geolocation post and the detection appears on Vidit
          within seconds. You do not leave your feed and you retype nothing. The
          bot stays silent for a handle not linked to a Vidit account. It reads
          public posts only, so a tag from a protected account imports nothing. Replying to a
          post that tagged the bot does not tag it again: X carries the mentions
          over into your reply, and the bot reads only the tag you type after
          your own words.
        </p>
        <div className={TILE}>
          <h3 className={TILE_TITLE}>Your post, then your own reply</h3>
          <p className={`mt-1.5 mb-4 ${NOTE}`}>
            Post the geolocation, then reply to yourself with the source and the
            tag. The bot reads both posts as one, and the detection is filed
            under the first of them, so tagging either one imports the same
            geolocation once. This is also how you import a post you published
            earlier. The coordinate, the source link and the tag can also sit on
            one post.
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
                  label: "the re-uploaded footage video (source)",
                }}
              >
                <MockPostLink>tiktok.com/@warfootage/video/7</MockPostLink>
                {"\n"}
                <MockPostLink>@viditbot</MockPostLink>
              </MockPost>
            </div>
          </div>
        </div>
        <div className={TILE}>
          <h3 className={TILE_TITLE}>No coordinate yet? It opens a request</h3>
          <p className={`mt-1.5 mb-4 ${NOTE}`}>
            Mirror someone else&apos;s footage with no coordinate of your own
            and the bot opens a request instead of refusing: the post you linked
            becomes the source, its own clip becomes the evidence, and the
            request goes on the board for anyone to geolocate. It is yours: it
            sits with your other open requests on your profile, where you edit
            it or withdraw it. When the link is an X post or a public Telegram
            post, the bot reads the clip and the date from it and the copy you
            attached is the fallback. Any other link, a YouTube video or a news
            page, works too, as long as you attach the clip yourself. Tag the
            same post again and nothing is duplicated.
          </p>
          <div className="space-y-3">
            <MockPost
              {...MOCK_ANALYST}
              media={{
                kind: "video",
                label: "your copy, kept only if the channel post serves none",
              }}
            >
              {"Wild Division work in the 82nd Brigade sector\n"}
              <MockPostLink>t.me/wilddivision82/351</MockPostLink>
              {"\n"}
              <MockPostLink>@viditbot</MockPostLink>
            </MockPost>
            <div className="pl-6">
              <MockPost {...MOCK_BOT} replyingTo={MOCK_ANALYST.handle}>
                {
                  "✅ Geolocation request opened · ref 5c02be71\nEdit it from your profile"
                }
              </MockPost>
            </div>
          </div>
        </div>
        <p className={NOTE}>
          The bot answers in-thread with your detection&apos;s reference and
          with what to fix at review: an empty source, several coordinates, a
          missing footage file or post date, or media already on Vidit. When
          nothing imports, it names why, a mirror with no clip attached
          included. Replies are capped per hour, so a burst of tags still
          creates every detection while some of them go unanswered.
        </p>
        <div className="sm:max-w-md">
          <MockPost {...MOCK_BOT} replyingTo={MOCK_ANALYST.handle}>
            {"✅ 1 detection saved · ref 94183d44\nReview from your profile"}
          </MockPost>
        </div>
      </Card>
    </PageShell>
  );
}

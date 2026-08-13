import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Upload } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import {
  NumberedSteps,
  type NumberedStep,
} from "@/components/ui/NumberedSteps";
import { MOCK_ANALYST, MockPost, MockPostLink } from "@/components/ui/MockPost";
import { DetailRow } from "@/components/ui/DetailRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { StatusBadge } from "@/components/event/StatusBadge";
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
        and drop the zip on the archive panel. Your browser strips the zip
        before uploading it, which reduces the upload size.
      </>
    ),
  },
];

const SECTION = "text-sm font-medium text-neutral-200";
const BODY = "text-sm text-neutral-300 leading-relaxed";

/** A permalink on the mock analyst's own timeline, the shape the resolution
 *  builds for `detected_from_url`. Only its host reaches the panel, so the id
 *  stands in for a real post without pretending to be one. */
const mockPermalink = (id: string) =>
  `https://x.com/${MOCK_ANALYST.handle.replace("@", "")}/status/${id}`;

/** One draft field's value: what the import filled it with, or an empty slot
 *  and the reason it stayed empty. */
type FieldValue = string | { empty: string };

/** The draft fields a case maps to, named as the detail surfaces name them
 *  (`Source media`, `Location` / `Coordinates`, `Source`, `Secondary sources`,
 *  `Proof`), so a reader meets the same vocabulary here and on the draft itself.
 *  `location` carries no empty state: a coordinate is what makes the draft
 *  exist. */
type DraftFields = {
  title: FieldValue;
  location: string;
  /** Muted annotation under the coordinates, where the pair needs one. */
  locationNote?: string;
  source: FieldValue;
  /** The mirrors the source slot did not take. Omitted when the post declared
   *  none, matching the real row, which its caller renders only for a non-empty
   *  list. */
  secondarySources?: string[];
  /** Permalink of the post the draft was detected from, the thread head's on a
   *  thread. Always set: the resolution anchors it on the head, and it is the
   *  idempotency key. Only its host reaches the row, as on the real surface. */
  detectedFrom: string;
  sourceMedia: FieldValue;
  /** The proof body the pipeline actually stores: the post text with
   *  coordinates, `t.co` wrappers, and list markers stripped. */
  proof: FieldValue;
  /** An image the proof document embeds, which this miniature can only name. */
  proofEmbed?: string;
};

/** The muted italic treatment the detail body gives a slot with nothing in it
 *  (its "No proof provided"), reused for every empty field here. */
function EmptyValue({ children }: { children: string }) {
  return <span className="text-neutral-500 italic">{children}</span>;
}

function Filled({ value }: { value: FieldValue }) {
  return typeof value === "string" ? (
    <span className="text-neutral-200">{value}</span>
  ) : (
    <EmptyValue>{value.empty}</EmptyValue>
  );
}

// The draft a case produces, as a miniature of the map's detail side panel:
// the same components (`StatusBadge`, `SectionEyebrow`, `DetailRow`), the same
// section order (Source media → Location → Details → Proof), the same rhythm
// (`space-y-4` between sections, `space-y-2` inside one, the Proof block behind
// a `border-t`), so the reader recognises the surface they land on after the
// import.
//
// The status pill sits where the real surface puts it, as the value of the
// `Status` row in Details, so the panel shows the draft exactly as the page
// will. `MediaGallery` and `AuthorByline` both take live rows, so the media
// slot states what lands in it, an embedded proof image is named in brackets,
// and the byline is left to the page intro.
function DraftPanel({ fields }: { fields: DraftFields }) {
  return (
    <div className="space-y-4">
      {/* The panel's title treatment, scaled to sit under the case heading. */}
      <h4 className="text-sm font-medium text-neutral-100">
        <Filled value={fields.title} />
      </h4>

      <div className="space-y-2">
        <SectionEyebrow as="h5" margin="none" title="Source media" />
        <p className="text-xs">
          <Filled value={fields.sourceMedia} />
        </p>
      </div>

      <div className="space-y-2">
        <SectionEyebrow as="h5" margin="none" title="Location" />
        <DetailRow label="Coordinates" compact className="gap-4 text-xs">
          <span className="text-right font-mono text-xs text-neutral-200">
            {fields.location}
          </span>
        </DetailRow>
        {fields.locationNote && (
          <p className="text-xs text-neutral-500">{fields.locationNote}</p>
        )}
      </div>

      <div className="space-y-2">
        <SectionEyebrow as="h5" margin="none" title="Details" />
        <div className="space-y-2 text-xs">
          <DetailRow label="Status" compact align="center">
            <StatusBadge status="detected" />
          </DetailRow>
          <DetailRow label="Source" compact className="gap-4">
            <span className="text-right">
              <Filled value={fields.source} />
            </span>
          </DetailRow>
          {fields.secondarySources && (
            <DetailRow
              label="Secondary sources"
              compact
              align="start"
              className="gap-4"
            >
              <div className="flex flex-col items-end gap-0.5 text-right text-neutral-200 [overflow-wrap:anywhere]">
                {fields.secondarySources.map((url) => (
                  <span key={url}>{url}</span>
                ))}
              </div>
            </DetailRow>
          )}
          {/* The provenance row, last in Details as on the real surface, and
              through the real `SourceLabel` so the host is reduced the same
              way. `inline` rather than `link`: these permalinks name posts that
              do not exist, and the mocks already hold that line. */}
          <DetailRow label="Detected from" compact className="gap-4">
            <SourceLabel
              url={fields.detectedFrom}
              variant="inline"
              className="text-neutral-200"
            />
          </DetailRow>
        </div>
      </div>

      <div className="border-t border-neutral-800 pt-2">
        <SectionEyebrow as="h5" margin="sm" title="Proof" />
        {typeof fields.proof === "string" ? (
          // `overflow-wrap:anywhere` for the reason the real proof body carries
          // it: a stored reference link is one unbreakable token.
          <p className="text-xs whitespace-pre-line text-neutral-200 [overflow-wrap:anywhere]">
            {`“${fields.proof}”`}
          </p>
        ) : (
          <p className="text-xs">
            <EmptyValue>{fields.proof.empty}</EmptyValue>
          </p>
        )}
        {fields.proofEmbed && (
          <p className="mt-1 text-xs text-neutral-500">{fields.proofEmbed}</p>
        )}
      </div>
    </div>
  );
}

// One import case as its own page-level block, a sibling of the other section
// cards rather than a row nested inside one: a case is one box, and `PageShell`
// spaces it against its neighbours. Inside it, the case title and the rule span
// the block, then the posts it reads sit beside the draft they produce, from
// `sm` up and stacked post-first on a phone.
//
// Every case carries the same three parts, in the same order: the title, the
// rule the worker applied, and the draft that came out. The rule line is the
// fine-print register the page already uses for its upload note. The title and
// rule share one wrapper so the `Card`'s own rhythm separates them from the
// grid rather than from each other.
function Case({
  title,
  rule,
  draft,
  children,
}: {
  title: string;
  /** The decision the worker makes, one sentence, mirroring
   *  `services/tweet_ingest/` (extract, stitch, resolve, archive). */
  rule: string;
  /** The draft fields this case's posts map to. */
  draft: DraftFields;
  children: ReactNode;
}) {
  return (
    <Card as="section">
      <div>
        <h3 className="text-sm font-medium text-neutral-100">{title}</h3>
        <p className="mt-2 text-xs text-neutral-500 leading-relaxed">{rule}</p>
      </div>
      {/* `min-w-0` on both tracks: a grid item defaults to `min-width: auto`,
          so a long link token inside either column would widen the track past
          the card instead of wrapping. */}
      <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
        <div className="min-w-0 space-y-3">{children}</div>
        <div className="min-w-0">
          <DraftPanel fields={draft} />
        </div>
      </div>
    </Card>
  );
}

export default function ArchiveGuidePage() {
  return (
    <PageShell title={TITLE} back backFallback="/about">
      <Card as="section">
        <p className={BODY}>
          Vidit reads your X archive and creates a draft event for each
          geolocation it finds. Threads and media files import intact. Drafts
          appear on the map immediately, labeled as machine drafts and
          attributed to your account. Review each draft to publish it as a
          geolocation or to reject it.
        </p>
      </Card>

      <Card as="section">
        <h2 className={SECTION}>Getting the export</h2>
        <NumberedSteps steps={STEPS} />
        <p className="text-xs text-neutral-400 leading-relaxed">
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
      </Card>

      {/* The heading and the copy a reader must read before the cases below,
          which are page-level blocks of their own. */}
      <Card as="section">
        <h2 className={SECTION}>From post to detected</h2>
        <p className={BODY}>
          A post becomes a draft when its text contains a coordinate. Vidit
          rejoins your self threads first, so a thread is read as one post. Each
          case below shows a post and the draft fields it fills. The last five
          are the order Vidit reads a source in.
        </p>
      </Card>

      <Case
        title="A post with coordinates"
        rule="A coordinate parses when a line carries a decimal pair with three or more decimals on each half, a hemisphere or DMS form, or a Google Maps link, and the title is then the first line still holding a word once hashtags, links, and the coordinate are stripped from it."
        draft={{
          title: "Strike on the vehicle depot",
          location: "48.123456, 37.654321",
          source: { empty: "No source declared" },
          sourceMedia: { empty: "No footage declared" },
          detectedFrom: mockPermalink("1783"),
          proof: "Strike on the vehicle depot",
          proofEmbed: "[the photo you attached]",
        }}
      >
        <MockPost
          {...MOCK_ANALYST}
          media={{ kind: "image", label: "a photo you attached" }}
        >
          {"Strike on the vehicle depot\n48.123456, 37.654321"}
        </MockPost>
      </Case>

      <Case
        title="Coordinates and nothing else"
        rule="The same title pass strips the coordinate out of every line, finds no word left on any of them, and returns an empty title rather than a guess."
        draft={{
          title: { empty: "No title, you name it at review" },
          location: "49.842900, 24.031100",
          source: { empty: "No source declared" },
          sourceMedia: { empty: "No footage declared" },
          detectedFrom: mockPermalink("1791"),
          proof: { empty: "No proof provided" },
        }}
      >
        <MockPost {...MOCK_ANALYST}>{"49.842900, 24.031100"}</MockPost>
      </Case>

      <Case
        title="A self thread"
        rule="Posts whose reply edge points at another post in the same archive are joined into one thread ordered by timestamp and then by post id, so the earliest post supplies the date and the link back to X while the title is read from the joined text."
        draft={{
          title: "Bridge span dropped overnight",
          location: "49.842900, 24.031100",
          source: { empty: "No source declared" },
          sourceMedia: "The video you attached",
          detectedFrom: mockPermalink("1804"),
          proof: "Bridge span dropped overnight\nGeolocated it",
        }}
      >
        <MockPost
          {...MOCK_ANALYST}
          media={{ kind: "video", label: "the video you attached" }}
        >
          {"Bridge span dropped overnight"}
        </MockPost>
        <div className="pl-6">
          <MockPost {...MOCK_ANALYST} replyingTo={MOCK_ANALYST.handle}>
            {"Geolocated it\n49.842900, 24.031100"}
          </MockPost>
        </div>
      </Case>

      <Case
        title="Several coordinates"
        rule="Parsing de-duplicates the pairs it finds at six decimal places and stops at three candidates, and one draft is emitted per surviving coordinate."
        draft={{
          title: "Two sites hit overnight",
          location: "48.123456, 37.654321 and 49.842900, 24.031100",
          locationNote: "One draft each, sharing every other field.",
          source: { empty: "No source declared" },
          sourceMedia: { empty: "No footage declared" },
          detectedFrom: mockPermalink("1812"),
          proof: "Two sites hit overnight",
        }}
      >
        <MockPost {...MOCK_ANALYST}>
          {
            "Two sites hit overnight\n48.123456, 37.654321\n49.842900, 24.031100"
          }
        </MockPost>
      </Case>

      <Case
        title="A quoted post"
        rule="Source resolution reads the thread for a quote first, so a quote takes the slot ahead of every link, and its media is the only footage considered even when the quoted post carried none."
        draft={{
          title: "Geolocated this one",
          location: "49.842900, 24.031100",
          locationNote: "Read from the quoted text, your own carried none.",
          source: "The quoted post, with its post date",
          sourceMedia: "The quoted video",
          detectedFrom: mockPermalink("1826"),
          proof: "Geolocated this one.",
        }}
      >
        <MockPost
          {...MOCK_ANALYST}
          quoted={{
            handle: "@warfootage",
            text: "Footage near 49.842900, 24.031100 by the bridge",
            media: { kind: "video", label: "the quoted video (source)" },
          }}
        >
          {"Geolocated this one."}
        </MockPost>
      </Case>

      <Case
        title="A link Vidit can fetch"
        rule="The worker follows the link a Source: line names, or the thread's only footage link when no line names one, and fetches it only when it is an X post or a public Telegram post; two footage links with no Source: line are ambiguous and leave the slot empty for review."
        draft={{
          title: "Depot hit",
          location: "48.921700, 24.708600",
          source: "t.me/somechannel/42, with its post date",
          sourceMedia: "The footage, when that post serves it",
          detectedFrom: mockPermalink("1833"),
          proof: "Depot hit\nSource: https://t.me/somechannel/42",
        }}
      >
        <MockPost {...MOCK_ANALYST}>
          {"Depot hit\n48.921700, 24.708600\nSource: "}
          <MockPostLink>t.me/somechannel/42</MockPostLink>
        </MockPost>
      </Case>

      <Case
        title="Two footage links, no Source: line"
        rule="Nothing designates a source, so the sole-candidate rule finds two footage links and fills nothing, and every candidate the source slot did not take lands in the secondary source links for you to promote one at review."
        draft={{
          title: "Depot hit",
          location: "48.921700, 24.708600",
          source: { empty: "No source, two candidates are ambiguous" },
          secondarySources: [
            "x.com/warfootage/status/1783",
            "t.me/somechannel/42",
          ],
          sourceMedia: { empty: "No footage, nothing is fetched" },
          detectedFrom: mockPermalink("1847"),
          proof:
            "Depot hit\nhttps://x.com/warfootage/status/1783\nhttps://t.me/somechannel/42",
        }}
      >
        <MockPost {...MOCK_ANALYST}>
          {"Depot hit\n48.921700, 24.708600\n"}
          <MockPostLink>x.com/warfootage/status/1783</MockPostLink>
          {"\n"}
          <MockPostLink>t.me/somechannel/42</MockPostLink>
        </MockPost>
      </Case>

      <Case
        title="A link on any other platform"
        rule="A Source: line designates its link whatever the platform, and the link is stored as it is; without that line a link off X, Telegram, and YouTube is not read as footage at all."
        draft={{
          title: "Bridge span dropped overnight",
          location: "49.842900, 24.031100",
          source: "instagram.com/reel/DTN83",
          sourceMedia: { empty: "No footage, nothing is fetched" },
          detectedFrom: mockPermalink("1858"),
          proof:
            "Bridge span dropped overnight\nSource: https://instagram.com/reel/DTN83",
        }}
      >
        <MockPost {...MOCK_ANALYST}>
          {"Bridge span dropped overnight\n49.842900, 24.031100\nSource: "}
          <MockPostLink>instagram.com/reel/DTN83</MockPostLink>
        </MockPost>
      </Case>

      <Case
        title="Your own video"
        rule="The promotion runs only once the source slot is still empty after the quote and the fetched footage were checked, it moves the thread's first video out of the proof, and it leaves the source link untouched."
        draft={{
          title: "Filmed this myself",
          location: "48.921700, 24.708600",
          source: { empty: "No source, a promotion declares none" },
          sourceMedia: "The video you attached",
          detectedFrom: mockPermalink("1866"),
          proof: "Filmed this myself",
        }}
      >
        <MockPost
          {...MOCK_ANALYST}
          media={{ kind: "video", label: "the video you attached" }}
        >
          {"Filmed this myself\n48.921700, 24.708600"}
        </MockPost>
      </Case>

      <Card as="section">
        <h2 className={SECTION}>What is skipped</h2>
        <ul className="list-disc space-y-1.5 pl-4 text-sm text-neutral-300">
          <li>
            <span className="text-neutral-100">Retweets.</span>
            {" A retweet contains another account’s post."}
          </li>
          <li>
            <span className="text-neutral-100">
              Posts with no coordinate in their text.
            </span>{" "}
            Vidit reads coordinates from text only. A coordinate that appears
            only inside an image is not read.
          </li>
          <li>
            <span className="text-neutral-100">Posts already imported.</span>{" "}
            Re-uploading the same archive creates no duplicates. To resume a
            failed import, upload the same file again.
          </li>
        </ul>
      </Card>
    </PageShell>
  );
}

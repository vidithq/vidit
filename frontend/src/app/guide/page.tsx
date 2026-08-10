import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { TEXT_LINK } from "@/components/ui/styles";

// Public getting-started guide, reachable without an account (see
// `PUBLIC_PREFIXES` in `proxy.ts`). This is where the platform's overall
// loop is taught: the pages themselves carry no explanatory subtitles, so a
// reader sizing up Vidit learns the whole cycle here and the two deeper
// guides (`/methodology`, `/bot`) pick up from it. Linked from the about
// page's Guides section and from the landing. Server component for SEO,
// composed from the same PageShell + Card primitives as the methodology
// guide.

const TITLE = "How Vidit works";
const DESCRIPTION =
  "The Vidit loop end to end: explore the map, read a geolocation and its proof, publish your own work, and pick up open requests.";

// Same openGraph + twitter shape as the landing so a shared link reads as
// Vidit, not a bare title. The shared `opengraph-image.tsx` /
// `twitter-image.tsx` at the app root supply the image without per-page
// binary assets.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "https://vidit.app/guide",
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

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Explore the map",
    body: (
      <>
        Everything lives on the{" "}
        <Link href="/map" className={TEXT_LINK}>
          map
        </Link>
        : every located event is a pin you can open. Each event carries a
        status, so you always know what you are reading. Geolocated means a
        person placed it and stands behind it. Detected is a machine-imported
        draft, rendered marked everywhere until its owner reviews and publishes
        it. Requested is footage nobody has placed yet.{" "}
        <Link href="/search" className={TEXT_LINK}>
          Search
        </Link>{" "}
        and the filters (conflict, capture source, dates, analyst) reach the
        same events from another angle.
      </>
    ),
  },
  {
    title: "Read a geolocation",
    body: (
      <>
        Open one and the anatomy is always the same: the coordinates, the event
        date, a link to the source post, and the media itself, copied into
        Vidit&apos;s own storage the moment it lands so it outlives a deleted
        post or a banned account. Under it sits the proof, the visual argument
        that the coordinates are right: the source frame next to satellite
        imagery, with matching coloured boxes on the features that carry the
        match (the{" "}
        <Link href="/methodology" className={TEXT_LINK}>
          methodology guide
        </Link>{" "}
        builds one step by step). The byline names the analyst behind the work,
        and a geolocation that started as a request also credits the analyst who
        opened it.
      </>
    ),
  },
  {
    title: "Publish your work",
    body: (
      <>
        Accounts are invite-only today, so reading is open to everyone and
        publishing is not. Three ways in, all landing on the same map:
        <ul className="mt-1.5 space-y-1.5 list-disc pl-4">
          <li>
            The{" "}
            <Link href="/submit" className={TEXT_LINK}>
              submit form
            </Link>
            : fill in what you have. Two outcomes come out of the content. Place
            the coordinates and finish the proof and it publishes as a
            geolocation; stop at the footage, its source link and its post date
            and it publishes as a request for others to locate.
          </li>
          <li>
            Your X archive: upload the official export and every geolocation you
            already published is backfilled as drafts you review and publish, no
            manual re-entry.
          </li>
          <li>
            The bot: tag @ViditBot under a geolocation post on X and it lands
            here as a structured draft waiting in your queue (the{" "}
            <Link href="/bot" className={TEXT_LINK}>
              bot guide
            </Link>{" "}
            has the format). You never leave your feed.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Pick up requests",
    body: (
      <>
        When someone has footage they cannot place, they post it as a request:
        title, media, source and post date, no coordinates. It goes on the{" "}
        <Link href="/requests" className={TEXT_LINK}>
          requests board
        </Link>
        , where analysts can signal they are working on it. Fulfilling one does
        not create a second entry: the request becomes a full geolocation, owned
        by the analyst who located it and still crediting the analyst who opened
        it.
      </>
    ),
  },
];

export default function GuidePage() {
  return (
    <PageShell
      title={TITLE}
    >
      <Card as="section">
        <p className="text-sm text-neutral-300 leading-relaxed">
          Vidit is one shared map of conflict geolocations, each carrying the
          evidence behind it: the archived source media, the coordinates, and
          the proof that ties them together. Four steps, in the order an analyst
          meets them:
        </p>
        <ol className="space-y-3 list-none">
          {STEPS.map(({ title, body }, i) => (
            <li key={title} className="flex items-start gap-3">
              <span className="mt-0.5 size-6 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-[11px] text-neutral-400 font-medium shrink-0">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-neutral-100">{title}</p>
                <div className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                  {body}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

    </PageShell>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import {
  NumberedSteps,
  type NumberedStep,
} from "@/components/ui/NumberedSteps";
import { TEXT_LINK } from "@/components/ui/styles";
import DemoVideo from "@/components/landing/DemoVideo";
import { staticPageMetadata } from "../_og/metadata";

// Public (see `PUBLIC_PREFIXES` in `proxy.ts`) and linked from the registration email and the
// post-registration screen. The section ids are contract: other pages and messages link to them.

const TITLE = "Getting started";
const DESCRIPTION =
  "Find your way around Vidit: the layout, how to read a geolocation, the three statuses, how to bring your work in from X, how to work with other analysts, and your settings.";

export const metadata: Metadata = staticPageMetadata({
  path: "/guide",
  title: TITLE,
  description: DESCRIPTION,
});

const SECTIONS = {
  layout: "The layout",
  "reading-a-geolocation": "Reading a geolocation",
  statuses: "The three statuses",
  "bringing-your-work-in": "Bringing your work in",
  "working-with-others": "Working with others",
  settings: "Your settings",
} as const;

type SectionId = keyof typeof SECTIONS;

const HEADING = "text-sm font-medium text-neutral-200 max-sm:scroll-mt-16";
const SUBHEADING = "text-sm font-medium text-neutral-100";
const BODY = "text-sm text-neutral-300 leading-relaxed";
const LIST = "list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-neutral-400";

function Term({ children }: { children: ReactNode }) {
  return <span className="text-neutral-100">{children}</span>;
}

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  return (
    <Card as="section">
      <h2 id={id} className={HEADING}>
        {SECTIONS[id]}
      </h2>
      {children}
    </Card>
  );
}

const DETECTION_STEPS: NumberedStep[] = [
  {
    title: "It lands in your queue",
    body: "An import from X creates the detection, attributed to you. It is on the map from that moment, marked as machine-read, and it waits in the Detections queue on your profile. A dot on your profile picture in the rail says the queue holds something.",
  },
  {
    title: "You review it",
    body: "Open a row of the queue, or Start reviewing to work through them one after another on the same form. Check the coordinates, the source and the proof, correct the event date, and pick the conflict and the capture source.",
  },
  {
    title: "You submit it",
    body: "Submit asks for a second click, because it publishes the row as a geolocation under your name. From then on, every change you save is a new version on a public record.",
  },
];

export default function GuidePage() {
  const videoUrl = process.env.NEXT_PUBLIC_GUIDE_VIDEO_URL;
  return (
    <PageShell title={TITLE} back backFallback="/about">
      <Card as="section">
        {videoUrl && (
          <div className="aspect-video w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
            <DemoVideo src={videoUrl} label="Play the walkthrough video" />
          </div>
        )}
        <p className={BODY}>
          Vidit is one shared map of conflict geolocations. Each one carries
          the evidence behind it: the archived source media, the coordinates,
          and the proof that ties them together. This page covers what you need
          in your first session:
        </p>
        <ul className={LIST}>
          {(Object.keys(SECTIONS) as SectionId[]).map((id) => (
            <li key={id}>
              <Link href={`#${id}`} className={TEXT_LINK}>
                {SECTIONS[id]}
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Section id="layout">
        <p className={BODY}>
          The rail on the left edge of every page holds the places you go. Submit
          and Feed show once you are signed in.
        </p>
        <ul className={LIST}>
          <li>
            <Term>Map.</Term> Every located event is a pin. Hover a pin for a
            preview, click it to open the side panel, and open the full event
            page from the panel&apos;s title. The filters narrow the pins by
            status, conflict, capture source, dates, tags, analyst and
            approvals.
          </li>
          <li>
            <Term>Submit.</Term> The form for a new geolocation or request, and
            the two imports you run from Vidit: a pasted X post and your X
            archive.
          </li>
          <li>
            <Term>Requests.</Term> The board of footage nobody has placed yet,
            newest or oldest first. Post request opens one of your own.
          </li>
          <li>
            <Term>Feed.</Term> New geolocations and open requests from the
            analysts you follow, or from everyone.
          </li>
          <li>
            <Term>Search.</Term> Events, collections, analysts and
            organizations.
          </li>
          <li>
            <Term>About.</Term> The guides, this one included, and the
            commitments behind Vidit.
          </li>
        </ul>
        <p className={BODY}>
          The foot of the rail is yours: your profile, Notifications and
          Settings. A dot on Notifications counts what you have not read. On a
          wide screen, the control at the very bottom expands the rail to show
          labels beside the icons, and collapses it again.
        </p>
        <h3 className={SUBHEADING}>On a phone</h3>
        <p className={BODY}>
          The rail is hidden. The menu button in the top-left corner opens it
          as a drawer, with the same entries and their labels. On a page with a
          back arrow, the arrow sits beside the menu button. The drawer closes
          when you pick an entry, tap outside it, press Escape, or tap Close at
          its foot. On the map, a selected event opens as a sheet along the
          bottom edge.
        </p>
      </Section>

      <Section id="reading-a-geolocation">
        <p className={BODY}>
          Every event page has the same anatomy. The title and the byline head
          the page; the record reads down the main column, and the controls sit
          in the right rail (under the title on a phone).
        </p>
        <ul className={LIST}>
          <li>
            <Term>Byline.</Term> The analysts credited with the geolocation: the
            owner first, then any co-geolocator. A geolocation that started as a
            request also names the analyst who opened it, under Requested by.
          </li>
          <li>
            <Term>Source media.</Term> The footage, copied into Vidit&apos;s own
            storage when it lands, so it outlives a deleted post or a banned
            account. Graphic media stays behind a warning until you choose to
            see it.
          </li>
          <li>
            <Term>Location and coordinates.</Term> A map on the point, and the
            coordinates under it with two controls: open them in Google Maps, or
            copy them.
          </li>
          <li>
            <Term>Source and archived copy.</Term> Source is where the footage
            was first published. The archive mark beside it opens the stored
            snapshot when it is orange; grey means nobody has archived it yet.
            Detected from names the post a machine import read the event from.
          </li>
          <li>
            <Term>Details.</Term> The status, the event date, when the source
            was posted, the conflict, the capture source and the tags.
          </li>
          <li>
            <Term>Proof.</Term> The visual argument that the coordinates are
            right: the source frame beside satellite imagery, with matching
            coloured boxes on the features that carry the match. The{" "}
            <Link href="/methodology" className={TEXT_LINK}>
              methodology guide
            </Link>{" "}
            builds one step by step.
          </li>
          <li>
            <Term>Versions.</Term> A published geolocation is corrected by
            adding a version, never by overwriting. The version button at the
            top of the rail (v1, v2, and so on) opens any earlier version and
            the full history, with what each edit changed and who made it.
          </li>
          <li>
            <Term>Approvals.</Term> The Approvals card in the rail shows the
            analysts and organizations who approved the current version, and
            holds Approve for you when you may give one (see{" "}
            <Link href="#working-with-others" className={TEXT_LINK}>
              Working with others
            </Link>
            ).
          </li>
        </ul>
        <p className={BODY}>
          The rail also holds Share and Report. A question mark beside a field
          or a section explains it in one or two sentences.
        </p>
      </Section>

      <Section id="statuses">
        <p className={BODY}>
          Every event carries a status, so you always know what you are
          reading.
        </p>
        <ul className={LIST}>
          <li>
            <Term>Geolocated.</Term> A person placed it and stands behind it,
            through the submit form or by submitting a reviewed detection. It is
            not independently verified: approvals are how other analysts back
            it.
          </li>
          <li>
            <Term>Detected.</Term> Machine output read from an analyst&apos;s
            post on X. It is marked as a detection everywhere, its pin is a
            lighter shade, and nobody has vouched for it until its owner submits
            it.
          </li>
          <li>
            <Term>Requested.</Term> Footage nobody has placed yet: a title, the
            media, its source and its post date. It waits on the{" "}
            <Link href="/requests" className={TEXT_LINK}>
              Requests board
            </Link>
            . Geolocate on a request opens the submit form on it. Publishing
            turns the request itself into a geolocation that you own and that
            still credits the analyst who asked.
          </li>
        </ul>
        <p className={BODY}>
          A fourth status, Closed, ends any of the three: a withdrawn request, a
          rejected detection, or a geolocation its owner retracted. The page
          stays readable, with the reason beside it.
        </p>
        <h3 className={SUBHEADING}>From detection to geolocation</h3>
        <NumberedSteps steps={DETECTION_STEPS} />
        <p className={BODY}>
          Only you turn your detection into a geolocation. When one is not
          worth publishing, close it from its edit form instead.
        </p>
      </Section>

      <Section id="bringing-your-work-in">
        <p className={BODY}>
          Three ways read the geolocations you already post on X, and one form
          takes everything else. Each import reads only posts from the X handle
          linked to your account, which an admin links on request from
          Settings. The{" "}
          <Link href="/import#detection" className={TEXT_LINK}>
            import guide
          </Link>{" "}
          states what makes a detection, once for all three.
        </p>
        <ul className={LIST}>
          <li>
            <Term>Your X archive.</Term> Upload the official X export from
            Submit, and every geolocation you already published comes back as a
            detection. Vidit emails you when the import finishes.{" "}
            <Link href="/import#archive" className={TEXT_LINK}>
              Upload your X archive
            </Link>
          </li>
          <li>
            <Term>A pasted post.</Term> Paste the link to one of your posts in
            Submit, under From an X post. Nothing is posted under your handle.{" "}
            <Link href="/import#paste" className={TEXT_LINK}>
              Paste a post URL
            </Link>
          </li>
          <li>
            <Term>@ViditBot.</Term> Tag the bot under a geolocation post on X,
            and the detection appears on Vidit within seconds while you stay in
            your feed.{" "}
            <Link href="/import#bot" className={TEXT_LINK}>
              Tag @ViditBot on X
            </Link>
          </li>
          <li>
            <Term>The submit form.</Term> Fill in what you have on{" "}
            <Link href="/submit" className={TEXT_LINK}>
              Submit
            </Link>
            . Place the coordinates and finish the proof, and it publishes as a
            geolocation. Stop at the footage, its source link and its post date,
            and it publishes as a request for others to locate.
          </li>
        </ul>
      </Section>

      <Section id="working-with-others">
        <ul className={LIST}>
          <li>
            <Term>Approving.</Term> Approve, in the Approvals card of a
            published geolocation, adds your stamp to its current version. You
            cannot approve a geolocation you are credited on. Revoke takes your
            approval back. An approval covers one version: when the geolocation
            gets a new version, its earlier approvers are asked to approve
            again.
          </li>
          <li>
            <Term>Asking for an approval.</Term> On a geolocation you are
            credited on, Request approval in the same card asks an analyst or an
            organization. They are notified, and they approve or decline from
            the event page. Each analyst chooses who may ask them; the default
            is the people they follow.
          </li>
          <li>
            <Term>Inviting a co-geolocator.</Term> The owner invites another
            analyst from the Geolocators card on the edit page. The invited
            analyst accepts or declines on the event page, and once they accept,
            every byline credits them. Editing and closing stay with the owner,
            and a change of credit never makes a new version.
          </li>
          <li>
            <Term>Organizations.</Term> A team of analysts with its own public
            page. An org manager invites analysts who follow them and whom they
            follow back, and you answer the invitation on the organization&apos;s
            page. A member can approve in the organization&apos;s name (Approve
            as, beside Approve) and decline the approval requests addressed to
            it.
          </li>
          <li>
            <Term>Following and the feed.</Term> Follow on an analyst&apos;s
            profile puts their new geolocations and open requests in your{" "}
            <Link href="/feed" className={TEXT_LINK}>
              Feed
            </Link>
            , under Following. All shows every analyst&apos;s, and the filters
            narrow either view by kind, conflict, capture source, tags and
            approvals.
          </li>
        </ul>
      </Section>

      <Section id="settings">
        <ul className={LIST}>
          <li>
            <Term>Profile.</Term> Your profile is your public portfolio: a map
            of your coverage, figures on your work, your collections and your
            recent geolocations. Edit profile, the pencil beside your linked
            accounts, changes your picture, your bio and your links to X,
            Discord, GitHub and a website.
          </li>
          <li>
            <Term>Account.</Term> Settings shows your username, your email
            address and your linked X handle. Request a link there; an admin
            links the handle and you are notified.
          </li>
          <li>
            <Term>Notification channels.</Term> Every notification appears on
            your Notifications page, and each one links to where you act on it.
            In Settings, two switches per kind of notification choose whether it
            also reaches your verified email address and the devices where you
            turn on push. Each row states its default.
          </li>
          <li>
            <Term>Approval requests.</Term> Accept approval requests from picks
            who may ask you to approve their geolocations: People I follow (the
            default), Everyone, or Nobody.
          </li>
          <li>
            <Term>Display.</Term> Light mode, the accent colour, and whether the
            question marks show. Your choices are saved to your account.
          </li>
        </ul>
      </Section>
    </PageShell>
  );
}

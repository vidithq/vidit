import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AtSign,
  Building2,
  ClipboardCheck,
  Plus,
  Settings,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { IconTile } from "@/components/ui/IconTile";
import { NumberedSteps } from "@/components/ui/NumberedSteps";
import { TEXT_LINK } from "@/components/ui/styles";
import DemoVideo from "@/components/landing/DemoVideo";
import { StatusBadge } from "@/components/event/StatusBadge";
import { IMPORT_ENTRIES, IMPORT_GLYPH } from "@/lib/importEntries";
import type { EventStatus } from "@/types";
import { staticPageMetadata } from "../_og/metadata";
import SHOTS from "./shots.json";

// Public (see `PUBLIC_PREFIXES` in `proxy.ts`) and linked from the registration email and the
// post-registration screen. The section ids are contract: other pages and messages link to them.
// The screenshots and their legends both come from `shots.json`; `video/shoot-guide.js` re-shoots them.

const TITLE = "Getting started";
const DESCRIPTION =
  "Find your way around Vidit: the layout, how to read a geolocation, the statuses, how to bring your work in from X, how to work with other analysts, and your settings.";

export const metadata: Metadata = staticPageMetadata({
  path: "/guide",
  title: TITLE,
  description: DESCRIPTION,
});

const glyph = (Icon: LucideIcon) => <Icon size={13} strokeWidth={1.8} />;

const SECTIONS = {
  layout: { title: "The layout" },
  "reading-a-geolocation": { title: "Reading a geolocation" },
  statuses: { title: "The statuses" },
  "bringing-your-work-in": { title: "Bringing your work in" },
  "working-with-others": { title: "Working with others" },
  settings: { title: "Your settings" },
} as const;

type SectionId = keyof typeof SECTIONS;

const HEADING = "text-sm font-medium text-neutral-200 max-sm:scroll-mt-16";
const SUBHEADING = "text-sm font-medium text-neutral-100";
const BODY = "text-sm text-neutral-300 leading-relaxed";
const NOTE = "text-[13px] leading-relaxed text-neutral-400";
const FRAME = "rounded-lg border border-neutral-800 bg-neutral-900";
const TILES = "grid gap-3 sm:grid-cols-3";
const TILE_PAIRS = "grid gap-3 sm:grid-cols-2";

function Section({
  id,
  lead,
  children,
}: {
  id: SectionId;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card as="section">
      <h2 id={id} className={HEADING}>
        {SECTIONS[id].title}
      </h2>
      {lead && <p className={BODY}>{lead}</p>}
      {children}
    </Card>
  );
}

function Shot({ id, narrow = false }: { id: keyof typeof SHOTS; narrow?: boolean }) {
  const shot = SHOTS[id];
  const { width, height } = "clip" in shot ? shot.clip : shot.viewport;
  return (
    <figure
      className={
        narrow ? "grid items-start gap-4 sm:grid-cols-[12rem_1fr]" : "space-y-4"
      }
    >
      <Image
        src={`/guide/${shot.file}`}
        alt={shot.alt}
        width={width}
        height={height}
        unoptimized
        className={`h-auto w-full ${FRAME} ${narrow ? "max-sm:max-w-48" : ""}`}
      />
      <figcaption>
        <NumberedSteps steps={shot.markers.map(({ label }) => ({ title: label }))} />
      </figcaption>
    </figure>
  );
}

const STATUSES: { status: EventStatus; note: ReactNode }[] = [
  { status: "geolocated", note: "An analyst placed it and stands behind it." },
  { status: "detected", note: "Machine-read from an analyst's post on X, not yet vouched for." },
  {
    status: "requested",
    note: (
      <>
        Footage nobody has placed yet, on the{" "}
        <Link href="/requests" className={TEXT_LINK}>
          Requests board
        </Link>
        .
      </>
    ),
  },
  { status: "closed", note: "A withdrawn request, a rejected detection, or a retracted geolocation." },
];

const DETECTION_STEPS = [
  { title: "An import lands it in your Detections queue, on your profile." },
  { title: "You check the coordinates, the source, the proof and the date." },
  { title: "Submit publishes it as a geolocation under your name." },
];

const OTHERS = [
  { icon: ClipboardCheck, title: "Request approval", note: "Ask an analyst or an organization to approve your geolocation." },
  { icon: Users, title: "Co-geolocators", note: "Once you accept an owner's invite, every byline credits you." },
  { icon: Building2, title: "Organizations", note: "Members approve in the organization's name." },
];

const SETTINGS = [
  { icon: User, title: "Profile", note: "Your public portfolio: picture, bio and links." },
  { icon: AtSign, title: "X handle", note: "Request the link the imports need." },
  { icon: Settings, title: "Display", note: "Light mode, accent color, question marks." },
];

export default function GuidePage() {
  const videoUrl = process.env.NEXT_PUBLIC_GUIDE_VIDEO_URL;
  return (
    <PageShell title={TITLE} back backFallback="/about">
      {videoUrl && (
        <Card as="section">
          <div className={`aspect-video w-full overflow-hidden ${FRAME}`}>
            <DemoVideo src={videoUrl} label="Play the walkthrough video" />
          </div>
        </Card>
      )}

      <Section id="layout" lead="The rail on the left edge of every page holds the places you go.">
        <Shot id="layout" />
        <h3 className={SUBHEADING}>On a phone</h3>
        <Shot id="layout-phone" narrow />
      </Section>

      <Section
        id="reading-a-geolocation"
        lead={
          <>
            Every event page has the same parts, and the{" "}
            <Link href="/methodology" className={TEXT_LINK}>
              methodology guide
            </Link>{" "}
            shows how to build its proof.
          </>
        }
      >
        <Shot id="event" />
      </Section>

      <Section id="statuses" lead="Every event carries one status, so you know what you are reading.">
        <dl className="grid items-center gap-x-4 gap-y-3 sm:grid-cols-[auto_1fr]">
          {STATUSES.map(({ status, note }) => (
            <div key={status} className="contents">
              <dt>
                <StatusBadge status={status} />
              </dt>
              <dd className={NOTE}>{note}</dd>
            </div>
          ))}
        </dl>
        <h3 className={SUBHEADING}>From detection to geolocation</h3>
        <NumberedSteps steps={DETECTION_STEPS} />
      </Section>

      <Section
        id="bringing-your-work-in"
        lead={
          <>
            Each import reads only posts from the X handle linked to your
            account, and the{" "}
            <Link href="/import#detection" className={TEXT_LINK}>
              import guide
            </Link>{" "}
            says what makes a detection.
          </>
        }
      >
        <div className={TILE_PAIRS}>
          {IMPORT_ENTRIES.map(({ anchor, title, when }) => (
            <IconTile
              key={anchor}
              href={`/import#${anchor}`}
              icon={IMPORT_GLYPH[anchor]}
              title={title}
              note={when}
            />
          ))}
          <IconTile
            href="/submit"
            icon={glyph(Plus)}
            title="Fill in the submit form"
            note="Anything else, as a geolocation or a request."
          />
        </div>
      </Section>

      <Section id="working-with-others">
        <Shot id="approvals" />
        <h3 className={SUBHEADING}>Your Feed</h3>
        <Shot id="feed" />
        <div className={TILES}>
          {OTHERS.map(({ icon, title, note }) => (
            <IconTile key={title} icon={glyph(icon)} title={title} note={note} />
          ))}
        </div>
      </Section>

      <Section id="settings" lead="Settings sits at the foot of the rail once you are signed in.">
        <Shot id="notifications" />
        <div className={TILES}>
          {SETTINGS.map(({ icon, title, note }) => (
            <IconTile key={title} icon={glyph(icon)} title={title} note={note} />
          ))}
        </div>
      </Section>
    </PageShell>
  );
}

import type { Metadata } from "next";
import {
  ShieldCheck,
  Users,
  AtSign,
  MessageCircle,
  Mail,
  Lock,
  Coins,
  BookOpen,
  Compass,
  Crosshair,
  Bot,
  FileArchive,
  type LucideIcon,
} from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { TEXT_LINK } from "@/components/ui/styles";
import { LinkRow } from "@/components/ui/LinkRow";

// Same openGraph + twitter shape as the landing so a shared link reads as
// Vidit, not a bare title. The shared `opengraph-image.tsx` /
// `twitter-image.tsx` at the app root supply the image without per-page
// binary assets.
export const metadata: Metadata = {
  title: "About Vidit",
  description:
    "Commitments, funding, and privacy posture behind Vidit, the open OSINT/GEOINT platform for archiving and mapping conflict geolocations.",
  openGraph: {
    type: "website",
    url: "https://vidit.app/about",
    siteName: "Vidit",
    title: "About Vidit",
    description: "Commitments, funding, and privacy posture behind Vidit.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@vidithq",
    creator: "@vidithq",
    title: "About Vidit",
    description: "Commitments, funding, and privacy posture behind Vidit.",
  },
};

const COMMITMENTS = [
  {
    title: "Free for analysts, forever",
    body: "Vidit will always be free for analysts. No ads, no paywalls, no subscription, no upsell, ever. The people doing the work shouldn't be the ones funding the platform. That is a hard constraint, not a launch promotion.",
  },
  {
    title: "Attribution we can enforce",
    body: "Twitter and Telegram can't help you when a media outlet reuses your geolocation without crediting you. Vidit will. We'll formalise the licence terms before open registration and pursue uncredited reuse as a project commitment. As the legal entity hosting the work, the platform can give the community a piece of standing it doesn't get from social media.",
  },
  {
    title: "Your work, kept safe and verifiable",
    body: "Every file you submit is copied to our own storage the instant it lands: images stripped of EXIF and location metadata to protect you (video metadata stripping is coming), fingerprinted with a SHA-256 content hash, and held under a retention lock so it can't be silently altered or deleted. The geolocation you submit today still resolves a year from now, even if the original post is gone.",
  },
  {
    title: "Transparency",
    body: "Every geolocation displays its source URL, the analyst behind it, and the event date. The submission stays publicly tied to the analyst who posted it.",
  },
];

// Lucide dropped the brand-mark icons (Github, X, Discord), so this panel
// only uses lucide for channels it still covers; GitHub is a footer link
// instead of pulling in a brand-icon dependency here.
const CONTACT = [
  {
    icon: AtSign,
    label: "X / Twitter",
    value: "@vidithq",
    href: "https://x.com/vidithq",
    external: true,
  },
  {
    icon: MessageCircle,
    label: "Discord",
    value: "discord.gg/9wPtsrrKyJ",
    href: "https://discord.gg/9wPtsrrKyJ",
    external: true,
  },
  {
    icon: Mail,
    label: "Email",
    value: "hello@vidit.app",
    href: "mailto:hello@vidit.app",
    external: false,
  },
];

// The in-product guides, gathered here since About is their hub: the rail
// carries no per-guide entry, and the bot guide's external readers arrive
// from the bot's X bio and replies. Getting started leads: it teaches the
// whole loop, and the other two go deeper into one part of it.
const GUIDES = [
  {
    icon: Compass,
    label: "Getting started",
    value: "How Vidit works",
    href: "/guide",
  },
  {
    icon: Crosshair,
    label: "Methodology",
    value: "Building a proof",
    href: "/methodology",
  },
  {
    icon: Bot,
    label: "Bot guide",
    value: "Import by tagging @ViditBot",
    href: "/bot",
  },
  {
    icon: FileArchive,
    label: "Archive guide",
    value: "Import your X archive",
    href: "/archive",
  },
];

interface SectionProps {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}

function Section({ icon: Icon, title, children }: SectionProps) {
  return (
    <Card as="section">
      <div className="flex items-center gap-2.5">
        <span className="size-7 rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center text-orange-400 shrink-0">
          <Icon size={14} />
        </span>
        <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

export default function AboutPage() {
  return (
    <PageShell title="About">
        <Section
          icon={BookOpen}
          title="Guides"
        >
          <div className="space-y-2">
            {GUIDES.map(({ icon, label, value, href }) => (
              <LinkRow
                key={label}
                icon={icon}
                label={label}
                value={value}
                href={href}
                external={false}
              />
            ))}
          </div>
        </Section>

        <Section
          icon={ShieldCheck}
          title="Commitments"
        >
          <ul className="space-y-3">
            {COMMITMENTS.map(({ title, body }) => (
              <li key={title}>
                <p className="text-sm font-medium text-neutral-100">{title}</p>
                <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          icon={Coins}
          title="Funding"
        >
          <p className="text-sm text-neutral-300 leading-relaxed">
            The aim is independence and longevity, not maximising revenue. In
            the long run, if the model works, the goal is to redistribute
            meaningful income back to the analysts whose geolocations the
            platform is built on. That is an ambition, not a promise.
          </p>
          <p className="text-sm text-neutral-300 leading-relaxed">
            Longer-term, the platform needs to cover its own costs without
            leaning on analysts. In rough order of preference: voluntary
            donations from people who find Vidit useful; a community crowdfund
            if the beta cohort feels the project deserves one; paid surfaces
            aimed at the people who <em>use</em> the community&apos;s work
            rather than the people doing it (alert subscriptions for
            newsrooms, API access for aggregators, custom integrations for
            institutional users).
          </p>
          <p className="text-sm text-neutral-300 leading-relaxed">
            Today, Vidit is a hobby project. All running costs (hosting,
            domain, storage, CDN, email) come out of one person&apos;s pocket.
            No investor, no grant, no ad revenue, no data resale.
          </p>
        </Section>

        <Section
          icon={Lock}
          title="Privacy"
        >
          <p className="text-sm text-neutral-300 leading-relaxed">
            Vidit only collects what it needs to operate: your email and
            username, the geolocations you submit, and sign-in timestamps.
            Vidit does not store IP addresses; network-level context exists
            only in our CDN&apos;s edge logs, outside the application.
            Everything is hosted in Europe today; the long-term ambition is a
            fully sovereign, self-hosted infrastructure that matches the
            threat model the community works under.
          </p>
          <p className="text-sm text-neutral-300 leading-relaxed">
            <span className="text-neutral-100 font-medium">
              Pseudonymous accounts are welcome.
            </span>{" "}
            We don&apos;t require legal names, we won&apos;t ask you to identify
            yourself, and we recommend using whatever handle you already use in
            the OSINT/GEOINT community. Operational security matters in this
            work; the platform is built around that.
          </p>
          <p className="text-sm text-neutral-300 leading-relaxed">
            We don&apos;t share user data with third parties, we don&apos;t run
            ads or cross-site trackers, we don&apos;t build user profiles, and
            we don&apos;t resell data. The platform does run cookieless,
            aggregate page metrics and crash reporting, neither of them tied to
            a person. To delete your account and your submissions, email{" "}
            <a
              href="mailto:hello@vidit.app"
              className={TEXT_LINK}
            >
              hello@vidit.app
            </a>{" "}
            from the address tied to the account, and we&apos;ll handle it. A
            full legal terms-of-service and privacy policy will land before
            open registration.
          </p>
        </Section>

        <Section
          icon={Users}
          title="Behind Vidit"
        >
          <p className="text-sm text-neutral-300 leading-relaxed">
            Vidit is a one-person project, maintained pseudonymously under
            operational security similar to the analysts the platform serves.
            Trust rests on the AGPL-3.0 guarantee and the auditable codebase,
            not on the maintainer&apos;s identity. The maintainer has followed
            the OSINT/GEOINT community for years on Twitter and Discord. As
            Vidit grows, so will the team.
          </p>
        </Section>

        <Section
          icon={MessageCircle}
          title="Stay in touch"
        >
          <div className="space-y-2">
            {CONTACT.map(({ icon, label, value, href, external }) => (
              <LinkRow
                key={label}
                icon={icon}
                label={label}
                value={value}
                href={href}
                external={external}
              />
            ))}
          </div>
        </Section>

    </PageShell>
  );
}

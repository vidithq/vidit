"use client";

import Link from "next/link";
import {
  ShieldCheck,
  Users,
  AtSign,
  MessageCircle,
  Mail,
  Crosshair,
  Lock,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { TAPPABLE_HOVER } from "@/components/ui/styles";

const COMMITMENTS = [
  {
    title: "Free for analysts, forever",
    body: "Vidit will always be free for analysts. No ads, no paywalls, no subscription, no upsell, ever. The people doing the work shouldn't be the ones funding the platform. That is a hard constraint, not a launch promotion.",
  },
  {
    title: "Attribution we can enforce",
    body: "Twitter and Telegram can't help you when a media outlet reuses your geolocation without crediting you. Vidit will. We'll formalise the licence terms before public launch and pursue uncredited reuse as a project commitment. As the legal entity hosting the work, the platform can give the community a piece of standing it doesn't get from social media.",
  },
  {
    title: "Your work, kept safe and verifiable",
    body: "Every file you submit is copied to our own storage the instant it lands: stripped of EXIF and location metadata to protect you, fingerprinted with a SHA-256 content hash, and held under a retention lock so it can't be silently altered or deleted. The geolocation you submit today still resolves a year from now, even if the original post is gone.",
  },
  {
    title: "Transparency",
    body: "Every geolocation displays its source URL, the analyst behind it, and the event date. The submission stays publicly tied to the analyst who posted it.",
  },
];

const PROOF_STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Verify and archive the source",
    body: (
      <>
        Reverse-image-search the source to rule out recycled footage from
        another conflict, and snapshot the link on{" "}
        <a
          href="https://archive.today"
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-400 hover:text-orange-300"
        >
          archive.today
        </a>{" "}
        so it survives if the original gets deleted.
      </>
    ),
  },
  {
    title: "Pin the visual anchors",
    body: "Pick three or more durable features in the source media: signage, road geometry, building footprints, infrastructure. Skip vehicles, smoke, or anything mobile.",
  },
  {
    title: "Cross-reference on satellite imagery",
    body: "Open the coordinates in Google Earth or Sentinel Hub. Confirm shape, scale, and relative position.",
  },
  {
    title: "Annotate the match",
    body: "On both images, draw matching coloured boxes around each anchor. Same colour for the same feature.",
  },
  {
    title: "Check the time-of-day",
    body: "Validate shadow direction and length against the timestamp. SunCalc takes 30 seconds.",
  },
  {
    title: "Optional: aerial alignment",
    body: "When the source is a drone or FPV clip, align camera trajectory and terrain profile to strengthen the match.",
  },
];

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

interface SectionProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
}

function Section({ icon: Icon, title, description, children }: SectionProps) {
  return (
    <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <span className="size-7 rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center text-orange-400 shrink-0">
            <Icon size={14} />
          </span>
          <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
        </div>
        {description && (
          <p className="text-xs text-neutral-500 pl-9">{description}</p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <PageShell title="About Vidit">
        <Section
          icon={ShieldCheck}
          title="Commitments"
          description="What Vidit promises analysts in return."
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
          icon={Crosshair}
          title="Methodology"
          description="How a Vidit proof comes together."
        >
          <p className="text-sm text-neutral-300 leading-relaxed">
            A geolocation proof is a visual argument: the source frame next to
            a satellite screenshot, with matching coloured boxes on the
            features that prove the match. Six short steps:
          </p>
          <ol className="space-y-3 list-none">
            {PROOF_STEPS.map(({ title, body }, i) => (
              <li key={title} className="flex items-start gap-3">
                <span className="mt-0.5 size-6 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-[11px] text-neutral-400 font-medium shrink-0">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-neutral-100">
                    {title}
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          icon={Coins}
          title="Funding"
          description="How Vidit pays for itself, today and longer-term."
        >
          <p className="text-sm text-neutral-300 leading-relaxed">
            Today, Vidit is a hobby project. All running costs (hosting,
            domain, storage, CDN, email) come out of one person&apos;s pocket.
            No investor, no grant, no ad revenue, no data resale.
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
            The aim is independence and longevity, not maximising revenue. In
            the long run, if the model works, the goal is to redistribute
            meaningful income back to the analysts whose geolocations the
            platform is built on. That is an ambition, not a promise.
          </p>
        </Section>

        <Section
          icon={Lock}
          title="Privacy"
          description="What we collect, and how to be removed."
        >
          <p className="text-sm text-neutral-300 leading-relaxed">
            Vidit only collects what it needs to operate: your email and
            username, the geolocations you submit, and your IP plus sign-in
            timestamps (kept for abuse detection and to protect your account).
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
            We don&apos;t share user data with third parties, and we don&apos;t
            run analytics or ad trackers. To delete your account and your
            submissions, email{" "}
            <a
              href="mailto:hello@vidit.app"
              className="text-orange-400 hover:text-orange-300"
            >
              hello@vidit.app
            </a>{" "}
            from the address tied to the account, and we&apos;ll handle it. A
            full legal terms-of-service and privacy policy will land before
            public launch.
          </p>
        </Section>

        <Section
          icon={Users}
          title="Behind Vidit"
          description="Who&rsquo;s building the platform."
        >
          <p className="text-sm text-neutral-300 leading-relaxed">
            For now, Vidit is a one-person project, built and maintained by a solo
            European developer who has followed the OSINT/GEOINT community
            for years on Twitter and Discord. As Vidit grows, so will the
            team.
          </p>
        </Section>

        <Section
          icon={MessageCircle}
          title="Stay in touch"
          description="Reach the team, file a bug, or hang out with the community."
        >
          <div className="space-y-2">
            {CONTACT.map(({ icon: Icon, label, value, href, external }) => (
              <a
                key={label}
                href={href}
                {...(external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className={`group flex items-center gap-3 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md ${TAPPABLE_HOVER}`}
              >
                <Icon size={14} className="text-neutral-500 shrink-0 group-hover:text-orange-400/70 transition-colors" />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] uppercase tracking-wider text-neutral-500">
                    {label}
                  </span>
                  <p className="text-sm truncate text-orange-400 group-hover:text-orange-300 transition-colors">
                    {value}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </Section>

        <p className="text-xs text-neutral-500 text-center">
          The best way to learn about the project is still to use it. Start on
          the{" "}
          <Link href="/map" className="text-orange-400 hover:underline">
            map
          </Link>
          .
        </p>
    </PageShell>
  );
}

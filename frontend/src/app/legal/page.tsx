import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK } from "@/components/ui/styles";

// Public legal notice, reachable without an account (see `PUBLIC_PREFIXES` in
// `proxy.ts`). Linked from the about page and from the auth screens. Server
// component, composed from the same PageShell + Card primitives as the
// methodology guide.
//
// The publisher is a non-professional one within the meaning of LCEN article
// 6-III-2, so only the hosting providers are identified by name, plus a contact
// address for notices. The maintainer's identity is held by the hosts, not
// published here.

const TITLE = "Legal notice";
const DESCRIPTION =
  "Publisher, hosting providers and contact for Vidit, an open OSINT geolocation platform.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "https://vidit.app/legal",
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

// Where takedown notices, data requests and other legal mail land.
const CONTACT_EMAIL = "support@vidit.app";

// The three providers that host the platform, each with the role it plays.
// Article 6-III-2 asks for the host's identity, so the list carries the legal
// name, the postal address and the site of each one.
const HOSTS = [
  {
    name: "Vercel Inc.",
    role: "hosts the site (web interface).",
    address: "440 N Barranca Ave #4133, Covina, CA 91723, United States",
    site: "https://vercel.com",
  },
  {
    name: "Railway Corp.",
    role: "hosts the API and the database.",
    address: "548 Market St PMB 68956, San Francisco, CA 94104, United States",
    site: "https://railway.com",
  },
  {
    name: "Amazon Web Services, Inc.",
    role: "stores and serves the media.",
    address: "410 Terry Avenue North, Seattle, WA 98109-5210, United States",
    site: "https://aws.amazon.com",
  },
];

const PARAGRAPH = "text-sm text-neutral-300 leading-relaxed";

export default function LegalPage() {
  return (
    <PageShell title={TITLE} back backFallback="/about">
      <div className="space-y-6">
        <Card as="section">
          <SectionEyebrow title="Site publisher" margin="none" />
          <p className={PARAGRAPH}>
            Vidit is published on a non-professional basis by a private
            individual. In accordance with article 6-III-2 of French law
            no. 2004-575 of 21 June 2004 on confidence in the digital economy
            (LCEN), the publisher has chosen not to make their identity public.
            The publisher&apos;s identifying details are held by the hosting
            providers, who keep them at the disposal of the judicial authority.
          </p>
          <p className={PARAGRAPH}>
            Publication director: the publisher, reachable at the contact
            address below.
          </p>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Hosting providers" margin="none" />
          {HOSTS.map((host) => (
            <p key={host.name} className={PARAGRAPH}>
              <span className="text-neutral-100">{host.name}</span>:{" "}
              {host.role}
              <br />
              {host.address}
              <br />
              <a href={host.site} className={TEXT_LINK}>
                {host.site}
              </a>
            </p>
          ))}
        </Card>

        <Card as="section">
          <SectionEyebrow title="Contact and reports" margin="none" />
          <p className={PARAGRAPH}>
            Any request, notice of illegal content or intellectual property
            complaint can be sent to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={TEXT_LINK}>
              {CONTACT_EMAIL}
            </a>
            . Every published content item can also be reported from its own
            page, without an account, using the red &quot;Report&quot; button.
            Reports are reviewed by an administrator, who can remove the
            content from public view.
          </p>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Content and liability" margin="none" />
          <p className={PARAGRAPH}>
            The geolocations, media and analyses published on Vidit are
            submitted by their authors, who remain responsible for them. Each
            publication shows its author and its original source. The publisher
            acts promptly to remove manifestly illegal content notified under
            the conditions set by law.
          </p>
          <p className={PARAGRAPH}>
            The platform&apos;s source code is released under the AGPL-3.0
            license.
          </p>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Personal data" margin="none" />
          <p className={PARAGRAPH}>
            The data processed, the purposes, the retention periods and how to
            exercise your rights are described in the{" "}
            <Link href="/privacy" className={TEXT_LINK}>
              privacy policy
            </Link>
            .
          </p>
        </Card>
      </div>
    </PageShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK } from "@/components/ui/styles";

// Public privacy policy, reachable without an account (see `PUBLIC_PREFIXES`
// in `proxy.ts`). Linked from the about page, the legal notice and the auth
// screens. Server component, same PageShell + Card composition as the legal
// notice.
//
// Every claim below is checked against the code that writes the data:
// `models/user.py` for the account, `models/auth_event.py` and
// `services/audit.py` for the connection log (no IP, no user agent: the client
// IP is a rate-limit key that never reaches a table),
// `models/pending_registration.py` and `services/registration.py` for the
// unconfirmed sign-up TTL, `services/maintenance.py` for the sweeps, and
// `models/content_report.py` for the reports. Change the code, change this
// page.

const TITLE = "Privacy policy";
const DESCRIPTION =
  "Data Vidit collects, purposes, retention periods and how to exercise your rights.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "https://vidit.app/privacy",
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

// Where data requests and other legal mail land, as on `/legal`.
const CONTACT_EMAIL = "support@vidit.app";

const PARAGRAPH = "text-sm text-neutral-300 leading-relaxed";
const LIST = "list-disc pl-5 space-y-2 text-sm text-neutral-300 leading-relaxed";

export default function PrivacyPage() {
  return (
    <PageShell title={TITLE} back backFallback="/about">
      <div className="space-y-6">
        <Card as="section">
          <SectionEyebrow title="Data collected" margin="none" />
          <ul className={LIST}>
            <li>
              <span className="text-neutral-100">Account</span>: email address,
              username, password hash, creation date. The username can be a
              pseudonym: no legal identity is requested.
            </li>
            <li>
              <span className="text-neutral-100">Profile</span>: bio, profile
              image URL and external links, all optional and provided by you.
            </li>
            <li>
              <span className="text-neutral-100">Submitted content</span>:
              geolocations, media, proofs, sources and tags, published under
              your username. EXIF metadata is stripped from images on receipt.
            </li>
            <li>
              <span className="text-neutral-100">Authentication log</span>:
              account identifier, event type (login, failed login, logout,
              password reset request, completed reset, password change and
              registration events) and timestamp. Neither IP address nor user
              agent appears in it.
            </li>
            <li>
              <span className="text-neutral-100">Reports</span>: the reason,
              the optional report text and, if the report comes from an
              account, that account&apos;s identifier. An anonymous report is
              not linked to anyone.
            </li>
            <li>
              <span className="text-neutral-100">Connection data</span>: your
              IP address is used only, and without being stored, as a request
              rate-limiting key. No table on the platform keeps it.
            </li>
            <li>
              <span className="text-neutral-100">Cookies</span>: a session
              cookie and an anti-CSRF cookie, both required for the site to
              work. No advertising cookies, no cross-site trackers.
            </li>
          </ul>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Purposes" margin="none" />
          <ul className={LIST}>
            <li>
              Maintain your account, authenticate you and send you service
              emails (registration confirmation, password reset).
            </li>
            <li>
              Publish the content you submit and attribute it to its author.
            </li>
            <li>
              Handle reports and moderate content that is illegal or was not
              flagged as sensitive.
            </li>
            <li>
              Protect the platform from abuse: request rate limiting and the
              authentication log, which serves to detect unusual activity on an
              account.
            </li>
          </ul>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Retention periods" margin="none" />
          <ul className={LIST}>
            <li>
              Account data and published content are kept for as long as the
              account exists.
            </li>
            <li>
              An unconfirmed registration expires after 24 hours and its row is
              deleted.
            </li>
            <li>
              Expired confirmation and reset tokens are deleted as soon as they
              expire; used tokens are deleted after 30 days.
            </li>
            <li>
              The authentication log and the reports are kept without a time
              limit: they are the records that establish what happened on an
              account and what was decided about a content item.
            </li>
            <li>
              Deleting an account removes the account and its contributions
              from all public view; permanent deletion, which also erases the
              stored files, is carried out on request.
            </li>
          </ul>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Recipients" margin="none" />
          <p className={PARAGRAPH}>
            Data is neither sold nor transferred. It is processed by the
            technical providers the site needs to run: application and database
            hosting, file storage, service email delivery, aggregate audience
            measurement and error reporting. The content you publish is, by
            nature, public.
          </p>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Your rights" margin="none" />
          <p className={PARAGRAPH}>
            You have the right to access, rectify and delete your data, as well
            as the right to object to and to restrict processing. The username,
            bio, profile image and external links can be edited directly from
            your settings.
          </p>
          <p className={PARAGRAPH}>
            For everything else, write to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={TEXT_LINK}>
              {CONTACT_EMAIL}
            </a>{" "}
            from the address linked to the account. You can also lodge a
            complaint with the CNIL, the French data protection authority.
          </p>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Publisher and hosting providers" margin="none" />
          <p className={PARAGRAPH}>
            The identity of the hosting providers and how to send notices are
            set out in the{" "}
            <Link href="/legal" className={TEXT_LINK}>
              legal notice
            </Link>
            .
          </p>
        </Card>
      </div>
    </PageShell>
  );
}

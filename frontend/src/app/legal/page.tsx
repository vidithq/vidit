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
// French, unlike the rest of the app: it is the notice French law asks a
// publisher established in France to serve, so it is served in the language of
// the readers and authorities it answers to. The root layout sets lang="en",
// so the content below carries its own lang="fr".
//
// The publisher is a non-professional one within the meaning of LCEN article
// 6-III-2, so only the hosting providers are identified by name, plus a contact
// address for notices. The maintainer's identity is held by the hosts, not
// published here.

const TITLE = "Mentions légales";
const DESCRIPTION =
  "Éditeur, hébergeurs et contact de Vidit, plateforme ouverte de géolocalisation OSINT.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "https://vidit.app/legal",
    siteName: "Vidit",
    title: TITLE,
    description: DESCRIPTION,
    locale: "fr_FR",
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
    role: "héberge le site (interface web).",
    address: "440 N Barranca Ave #4133, Covina, CA 91723, États-Unis",
    site: "https://vercel.com",
  },
  {
    name: "Railway Corp.",
    role: "héberge l'API et la base de données.",
    address: "548 Market St PMB 68956, San Francisco, CA 94104, États-Unis",
    site: "https://railway.com",
  },
  {
    name: "Amazon Web Services, Inc.",
    role: "stockage et diffusion des médias.",
    address: "410 Terry Avenue North, Seattle, WA 98109-5210, États-Unis",
    site: "https://aws.amazon.com",
  },
];

const PARAGRAPH = "text-sm text-neutral-300 leading-relaxed";

export default function LegalPage() {
  return (
    <PageShell title={TITLE} back backFallback="/about">
      <div lang="fr" className="space-y-6">
        <Card as="section">
          <SectionEyebrow title="Éditeur du site" margin="none" />
          <p className={PARAGRAPH}>
            Vidit est édité à titre non professionnel par une personne
            physique. Conformément à l&apos;article 6-III-2 de la loi
            n° 2004-575 du 21 juin 2004 pour la confiance dans
            l&apos;économie numérique, l&apos;éditeur a choisi de ne pas rendre
            publique son identité. Les éléments d&apos;identification de
            l&apos;éditeur sont conservés par les hébergeurs, qui les tiennent à
            la disposition de l&apos;autorité judiciaire.
          </p>
          <p className={PARAGRAPH}>
            Directeur de la publication : l&apos;éditeur, joignable à
            l&apos;adresse de contact indiquée ci-dessous.
          </p>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Hébergeurs" margin="none" />
          {HOSTS.map((host) => (
            <p key={host.name} className={PARAGRAPH}>
              <span className="text-neutral-100">{host.name}</span> :{" "}
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
          <SectionEyebrow title="Contact et signalements" margin="none" />
          <p className={PARAGRAPH}>
            Toute demande, notification de contenu illicite ou réclamation
            relative à la propriété intellectuelle peut être adressée à{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={TEXT_LINK}>
              {CONTACT_EMAIL}
            </a>
            . Chaque contenu publié peut également être signalé depuis sa page,
            sans compte, à l&apos;aide du bouton « Report this event ». Les
            signalements sont examinés par un administrateur, qui peut retirer
            le contenu de toute consultation publique.
          </p>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Contenus et responsabilité" margin="none" />
          <p className={PARAGRAPH}>
            Les géolocalisations, les médias et les analyses publiés sur Vidit
            sont soumis par leurs auteurs, qui en restent responsables. Chaque
            publication indique son auteur et sa source d&apos;origine.
            L&apos;éditeur agit promptement pour retirer un contenu manifestement
            illicite qui lui est signalé dans les conditions prévues par la loi.
          </p>
          <p className={PARAGRAPH}>
            Le code source de la plateforme est publié sous licence AGPL-3.0.
          </p>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Données personnelles" margin="none" />
          <p className={PARAGRAPH}>
            Les données traitées, leurs finalités, leur durée de conservation et
            la façon d&apos;exercer vos droits sont décrites dans la{" "}
            <Link href="/privacy" className={TEXT_LINK}>
              politique de confidentialité
            </Link>
            .
          </p>
        </Card>
      </div>
    </PageShell>
  );
}

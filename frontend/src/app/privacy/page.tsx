import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK } from "@/components/ui/styles";

// Public privacy policy, reachable without an account (see `PUBLIC_PREFIXES`
// in `proxy.ts`). Linked from the about page, the legal notice and the auth
// screens. Server component, same PageShell + Card composition as the legal
// notice, and French for the same reason.
//
// Every claim below is checked against the code that writes the data:
// `models/user.py` for the account, `models/auth_event.py` and
// `services/audit.py` for the connection log (no IP, no user agent: the client
// IP is a rate-limit key that never reaches a table),
// `models/pending_registration.py` and `services/registration.py` for the
// unconfirmed sign-up TTL, `services/maintenance.py` for the sweeps, and
// `models/content_report.py` for the reports. Change the code, change this
// page.

const TITLE = "Politique de confidentialité";
const DESCRIPTION =
  "Données collectées par Vidit, finalités, durées de conservation et exercice de vos droits.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "https://vidit.app/privacy",
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

// Where data requests and other legal mail land, as on `/legal`.
const CONTACT_EMAIL = "support@vidit.app";

const PARAGRAPH = "text-sm text-neutral-300 leading-relaxed";
const LIST = "list-disc pl-5 space-y-2 text-sm text-neutral-300 leading-relaxed";

export default function PrivacyPage() {
  return (
    <PageShell title={TITLE} back backFallback="/about">
      <div lang="fr" className="space-y-6">
        <Card as="section">
          <SectionEyebrow title="Données collectées" margin="none" />
          <ul className={LIST}>
            <li>
              <span className="text-neutral-100">Compte</span> : adresse
              électronique, nom d&apos;utilisateur, empreinte du mot de passe,
              date de création. Le nom d&apos;utilisateur peut être un
              pseudonyme : aucune identité civile n&apos;est demandée.
            </li>
            <li>
              <span className="text-neutral-100">Profil</span> : biographie,
              adresse d&apos;image de profil et liens externes, tous
              facultatifs et renseignés par vous.
            </li>
            <li>
              <span className="text-neutral-100">Contenus soumis</span> :
              géolocalisations, médias, preuves, sources et étiquettes, publiés
              sous votre nom d&apos;utilisateur. Les métadonnées EXIF des images
              sont supprimées à la réception.
            </li>
            <li>
              <span className="text-neutral-100">Journal
              d&apos;authentification</span> : identifiant de compte, type
              d&apos;évènement (connexion, échec de connexion, déconnexion,
              demande de réinitialisation du mot de passe, réinitialisation
              effectuée, changement de mot de passe et évènements
              d&apos;inscription) et horodatage. Ni adresse IP ni agent
              utilisateur n&apos;y figurent.
            </li>
            <li>
              <span className="text-neutral-100">Signalements</span> : le motif,
              le texte éventuel du signalement et, si le signalement provient
              d&apos;un compte, l&apos;identifiant de ce compte. Un signalement
              anonyme n&apos;est rattaché à personne.
            </li>
            <li>
              <span className="text-neutral-100">Données de connexion</span> :
              votre adresse IP sert uniquement, et sans être enregistrée, de
              clé de limitation du débit des requêtes. Aucune table de la
              plateforme ne la conserve.
            </li>
            <li>
              <span className="text-neutral-100">Cookies</span> : un cookie de
              session et un cookie anti-CSRF, tous deux nécessaires au
              fonctionnement du site. Aucun cookie publicitaire ni traceur
              inter-sites.
            </li>
          </ul>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Finalités" margin="none" />
          <ul className={LIST}>
            <li>
              Tenir votre compte, vous authentifier et vous envoyer les courriels
              de service (confirmation d&apos;inscription, réinitialisation du
              mot de passe).
            </li>
            <li>
              Publier les contenus que vous soumettez et les attribuer à leur
              auteur.
            </li>
            <li>
              Traiter les signalements et modérer les contenus illicites ou non
              signalés comme sensibles.
            </li>
            <li>
              Protéger la plateforme des abus : limitation du débit des requêtes
              et journal d&apos;authentification, qui sert à constater une
              activité anormale sur un compte.
            </li>
          </ul>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Durées de conservation" margin="none" />
          <ul className={LIST}>
            <li>
              Les données de compte et les contenus publiés sont conservés tant
              que le compte existe.
            </li>
            <li>
              Une inscription non confirmée expire au bout de 24 heures et sa
              ligne est supprimée.
            </li>
            <li>
              Les jetons de confirmation et de réinitialisation expirés sont
              supprimés dès leur expiration ; les jetons déjà utilisés le sont
              au bout de 30 jours.
            </li>
            <li>
              Le journal d&apos;authentification et les signalements sont
              conservés sans limite de durée : ce sont les traces qui permettent
              de constater ce qui s&apos;est passé sur un compte et ce qui a été
              décidé sur un contenu.
            </li>
            <li>
              La suppression d&apos;un compte retire le compte et ses
              contributions de toute consultation publique ; la suppression
              définitive, qui efface aussi les fichiers stockés, est effectuée
              sur demande.
            </li>
          </ul>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Destinataires" margin="none" />
          <p className={PARAGRAPH}>
            Les données ne sont ni vendues ni cédées. Elles sont traitées par
            les prestataires techniques nécessaires au fonctionnement du site :
            hébergement de l&apos;application et de la base de données, stockage
            des fichiers, envoi des courriels de service, mesure d&apos;audience
            agrégée et rapports d&apos;erreur. Les contenus que vous publiez
            sont, eux, publics par nature.
          </p>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Vos droits" margin="none" />
          <p className={PARAGRAPH}>
            Vous disposez d&apos;un droit d&apos;accès, de rectification et de
            suppression de vos données, ainsi que d&apos;un droit
            d&apos;opposition et à la limitation du traitement. Le nom
            d&apos;utilisateur, la biographie, l&apos;image de profil et les
            liens externes se modifient directement depuis vos réglages.
          </p>
          <p className={PARAGRAPH}>
            Pour tout le reste, écrivez à{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={TEXT_LINK}>
              {CONTACT_EMAIL}
            </a>{" "}
            depuis l&apos;adresse rattachée au compte. Vous pouvez également
            introduire une réclamation auprès de la CNIL.
          </p>
        </Card>

        <Card as="section">
          <SectionEyebrow title="Éditeur et hébergeurs" margin="none" />
          <p className={PARAGRAPH}>
            L&apos;identification des hébergeurs et les modalités de
            signalement figurent dans les{" "}
            <Link href="/legal" className={TEXT_LINK}>
              mentions légales
            </Link>
            .
          </p>
        </Card>
      </div>
    </PageShell>
  );
}

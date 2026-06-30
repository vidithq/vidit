"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { AtSign, Mail, MessageCircle } from "lucide-react";

import type { GeolocationDetail, GeolocationStatus, Tag } from "@/types";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TagPicker } from "@/components/ui/TagPicker";
import { EntityCard } from "@/components/ui/EntityCard";
import { GeolocationDetailBody } from "@/components/geolocation/GeolocationDetailBody";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { LinkRow } from "@/components/ui/LinkRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { TagBadge } from "@/components/ui/TagBadge";
import { TagChip } from "@/components/ui/TagChip";
import { Avatar } from "@/components/ui/Avatar";
import { MediaThumb } from "@/components/ui/MediaThumb";
import { CuratedTagsError } from "@/components/geolocations/CuratedTagsError";
import { OptionalHint } from "@/components/ui/OptionalHint";
import FieldHelp from "@/components/ui/FieldHelp";
import SourceLabel from "@/components/ui/SourceLabel";
import StatusBadge from "@/components/geolocation/StatusBadge";
import BountyStatusBadge from "@/components/bounty/BountyStatusBadge";
import {
  PRIMARY_BUTTON,
  TEXT_LINK,
  TAPPABLE_HOVER,
  FILTER_CHIP_ACTIVE,
  FILTER_CHIP_INACTIVE,
  BETA_PILL,
} from "@/components/ui/styles";
import {
  FORM_LABEL,
  FORM_INPUT,
  FORM_INPUT_COMPACT,
  FORM_INPUT_LOCKED,
  FORM_INVALID_FIELD,
  FORM_ERROR_BANNER,
} from "@/components/ui/form-styles";

/**
 * Living style guide: every reusable primitive, its variants, and a one-line
 * note on where it's used. Dev reference, not linked in the nav. Everything
 * here follows the accent palette (switchable in Settings -> Display).
 */

// One showcased component: a labelled card with the live preview + a usage note.
function Item({
  name,
  usage,
  children,
}: {
  name: string;
  usage: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-neutral-100 font-mono">{name}</h3>
        <span className="text-[11px] text-neutral-500 text-right">{usage}</span>
      </div>
      <div className="flex flex-wrap items-start gap-3 pt-1">{children}</div>
    </Card>
  );
}

// A small label above a single variant.
function Variant({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</p>
      {children}
    </div>
  );
}

const MOCK_TAGS = [
  { id: "1", name: "Ukraine" },
  { id: "2", name: "Drone" },
];

// A full geolocation, for the detail body + detection card. `is_demo` so the
// source renders as "synthetic" rather than a link that 404s.
const MOCK_DETAIL: GeolocationDetail = {
  id: "demo",
  title: "Frappe sur un dépôt, Donetsk",
  lat: 48.0159,
  lng: 37.8024,
  event_date: "2026-05-09",
  is_demo: true,
  status: "submitted",
  author: {
    id: "a1",
    username: "analyst",
    is_trusted: true,
    trust_reason: "Analyste vérifié",
  },
  tags: [
    { id: "t1", name: "Ukraine", category: "conflict" },
    { id: "t2", name: "Drone", category: "capture_source" },
    { id: "t3", name: "Donetsk", category: "free" },
  ],
  source_url: "synthetic://demo",
  event_time: "15:45:00",
  source_posted_at: "2026-05-09T15:45:00Z",
  detected_from_url: null,
  detected_post_at: null,
  proof: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  media: [],
  originated_from_bounty: null,
};

// The lighter geolocation-card payload (timeline / recent-submissions shape).
const MOCK_CARD_GEO = {
  id: "demo",
  title: "Frappe sur un dépôt près de Donetsk",
  event_date: "2026-05-09",
  is_demo: true,
  status: "detected" as GeolocationStatus,
  lat: 48.0159,
  lng: 37.8024,
  author: { username: "analyst" },
  tags: [
    { id: "t1", name: "Ukraine", category: "conflict" as const },
    { id: "t2", name: "Drone", category: "capture_source" as const },
  ],
};

const MOCK_CURATED: Tag[] = [
  { id: "c1", name: "Ukraine", category: "conflict" },
  { id: "c2", name: "Russia", category: "conflict" },
  { id: "cs1", name: "Drone", category: "capture_source" },
  { id: "cs2", name: "Satellite", category: "capture_source" },
];

export default function PalettePage() {
  // Dev reference only — a 404 in production / preview builds.
  if (process.env.NODE_ENV !== "development") notFound();

  const [chip, setChip] = useState(true);
  const [tpTags, setTpTags] = useState<Tag[]>([
    { id: "f1", name: "donetsk", category: "free" },
  ]);
  const [tpSelected, setTpSelected] = useState<string[]>([]);

  return (
    <PageShell
      title="Palette"
      subtitle="Composants réutilisables, leurs options, et où ils servent. Tout suit la couleur d'accent (Réglages → Affichage)."
    >
      <div className="space-y-8">
        {/* ---- Constantes de style ---- */}
        <section className="space-y-3">
          <SectionEyebrow title="Constantes de style" />

          <Item
            name="PRIMARY_BUTTON"
            usage="CTA principal: Submit, auth, actions admin"
          >
            <button className={`px-3 py-1.5 rounded-md text-xs font-medium ${PRIMARY_BUTTON}`}>
              Action principale
            </button>
          </Item>

          <Item name="TEXT_LINK" usage="Liens orange: bylines, « Back to X », retry, About">
            <a href="#" className={TEXT_LINK} onClick={(e) => e.preventDefault()}>
              Un lien texte
            </a>
          </Item>

          <Item
            name="FILTER_CHIP_ACTIVE / _INACTIVE"
            usage="Chips de filtre: panneau carte, bounties, recherche"
          >
            <Variant label="active">
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${FILTER_CHIP_ACTIVE}`}>
                Sélectionné
              </span>
            </Variant>
            <Variant label="inactive">
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${FILTER_CHIP_INACTIVE}`}>
                Neutre
              </span>
            </Variant>
          </Item>

          <Item name="BETA_PILL" usage="Bannière « Closed beta » (coin bas-droit)">
            <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-medium ${BETA_PILL}`}>
              <span className="size-1.5 rounded-full bg-orange-500" />
              Closed beta
            </span>
          </Item>

          <Item
            name="TAPPABLE_HOVER"
            usage="Cartes/lignes cliquables: bordure d'accent au survol"
          >
            <div className={`px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-md text-xs text-neutral-300 ${TAPPABLE_HOVER}`}>
              Survole-moi
            </div>
          </Item>
        </section>

        {/* ---- Formulaires ---- */}
        <section className="space-y-3">
          <SectionEyebrow title="Formulaires" />

          <Item name="FORM_LABEL + FORM_INPUT" usage="Tous les champs de formulaire (submit, edit, auth, settings)">
            <div className="w-full max-w-sm space-y-1.5">
              <label className={FORM_LABEL}>Label du champ</label>
              <input className={FORM_INPUT} placeholder="Saisie..." />
            </div>
          </Item>

          <Item name="FORM_INPUT_COMPACT" usage="Champs « façon ligne de données »: admin, raison de trust">
            <input className={`${FORM_INPUT_COMPACT} max-w-sm`} placeholder="Compact" />
          </Item>

          <Item name="FORM_INPUT_LOCKED" usage="Champ hérité d'une bounty, lecture seule">
            <input className={`${FORM_INPUT_LOCKED} max-w-sm`} value="Verrouillé" readOnly />
          </Item>

          <Item name="FORM_INVALID_FIELD" usage="Champ/section signalé manquant (IncompleteFormNotice)">
            <input className={`${FORM_INPUT} ${FORM_INVALID_FIELD} max-w-sm`} placeholder="Champ invalide" />
          </Item>

          <Item name="FORM_ERROR_BANNER" usage="Erreur de formulaire au-dessus des actions">
            <div className={`${FORM_ERROR_BANNER} max-w-sm`}>Quelque chose s’est mal passé.</div>
          </Item>
        </section>

        {/* ---- Structure ---- */}
        <section className="space-y-3">
          <SectionEyebrow title="Structure" />

          <Item name="<Card>" usage="Panneaux: settings, admin, profil, sections de formulaire. Un seul rythme (space-y-4) pour toutes.">
            <Card className="w-48">
              <p className="text-xs text-neutral-300">Contenu</p>
              <p className="text-xs text-neutral-500">Deuxième ligne</p>
            </Card>
          </Item>

          <Item name="<SectionHeading>" usage="En-tête de section de formulaire (Details, Location, Tags...)">
            <SectionHeading title="Source media" concept="source_media" />
            <SectionHeading title="Proof" concept="section_proof" optional />
          </Item>

          <Item name="<SectionEyebrow>" usage="En-tête des pages détail (SOURCE MEDIA, LOCATION, DETAILS)">
            <Variant label="as=h2 (page)">
              <SectionEyebrow title="Details" concept="section_details" />
            </Variant>
            <Variant label="sans concept">
              <SectionEyebrow title="Working on" />
            </Variant>
          </Item>

          <Item name="<EmptyState>" usage="Listes vides: bounties, recherche">
            <EmptyState className="max-w-sm">
              Rien ici pour l’instant.{" "}
              <a href="#" className={TEXT_LINK} onClick={(e) => e.preventDefault()}>
                Créer le premier
              </a>
              .
            </EmptyState>
          </Item>
        </section>

        {/* ---- Lignes & détails ---- */}
        <section className="space-y-3">
          <SectionEyebrow title="Lignes & détails" />

          <Item name="<DetailCard> + <DetailRow>" usage="Pages détail géoloc & bounty (libellé / valeur)">
            <div className="w-full max-w-md">
              <DetailCard>
                <DetailRow label="Status" concept="status">
                  <StatusBadge status="submitted" />
                </DetailRow>
                <DetailRow label="Source" concept="source_url" value="t.me/channel/123" />
                <DetailRow label="Coordinates" concept="coordinates" value="48.0159, 37.8024" />
              </DetailCard>
            </div>
          </Item>

          <Item name="<LinkRow>" usage="Comptes liés (profil) + « Stay in touch » (About)">
            <div className="w-full max-w-md space-y-2">
              <LinkRow icon={AtSign} label="X / Twitter" value="@vidithq" href="https://x.com/vidithq" />
              <LinkRow icon={Mail} label="Email" value="hello@vidit.app" href="mailto:hello@vidit.app" external={false} />
              <LinkRow icon={MessageCircle} label="Discord" value="un-pseudo (non résolu)" />
            </div>
          </Item>
        </section>

        {/* ---- Badges & pastilles ---- */}
        <section className="space-y-3">
          <SectionEyebrow title="Badges & pastilles" />

          <Item name="<Pill>" usage="Forme commune de tous les badges ci-dessous (StatusBadge, BountyStatusBadge, TagBadge)">
            <Variant label="tone + icône">
              <Pill tone="bg-orange-500/15 text-orange-400 border border-orange-500/30">
                Accent
              </Pill>
            </Variant>
            <Variant label="tone neutre">
              <Pill tone="bg-neutral-700/40 text-neutral-300 border border-neutral-600/50">
                Neutre
              </Pill>
            </Variant>
          </Item>

          <Item name="<TagBadge>" usage="Tags décoratifs sur cartes & pages détail">
            {MOCK_TAGS.map((t) => (
              <TagBadge key={t.id} name={t.name} />
            ))}
          </Item>

          <Item name="<StatusBadge>" usage="État d'une géoloc: cartes, détail, file de détections">
            <StatusBadge status="detected" />
            <StatusBadge status="submitted" />
          </Item>

          <Item name="<BountyStatusBadge>" usage="État d'une bounty: liste & détail">
            <BountyStatusBadge status="open" />
            <BountyStatusBadge status="fulfilled" />
            <BountyStatusBadge status="closed" />
          </Item>

          <Item name="<TagChip>" usage="Sélection de tags (TagPicker, formulaires)">
            <TagChip tag={{ id: "x", name: "Cliquable", category: "free" }} active={chip} onClick={() => setChip((v) => !v)} />
            <span className="text-[11px] text-neutral-600 self-center">← clique</span>
          </Item>

          <Item name="<FieldHelp> + <OptionalHint>" usage="Aide « ? » sur labels/sections + marqueur « optional »">
            <span className="inline-flex items-center gap-1 text-sm text-neutral-300">
              Coordonnées <FieldHelp concept="coordinates" /> <OptionalHint />
            </span>
          </Item>

          <Item name="<SourceLabel>" usage="Affichage d'une source (host réduit, ou « synthetic » en démo)">
            <SourceLabel isDemo={false} url="https://t.me/some_channel/4242" variant="inline" />
            <SourceLabel isDemo url="synthetic://demo" variant="inline" />
          </Item>
        </section>

        {/* ---- Média & avatars ---- */}
        <section className="space-y-3">
          <SectionEyebrow title="Média & avatars" />

          <Item name="<MediaThumb>" usage="Vignette des cartes bounty (liste & recherche)">
            <MediaThumb />
          </Item>

          <Item name="<Avatar>" usage="Header profil (icône) + résultats utilisateur recherche (initiale)">
            <Variant label='fallback="icon"'>
              <Avatar username="demo" size="w-16 h-16" fallback="icon" />
            </Variant>
            <Variant label='fallback="initial"'>
              <Avatar username="Marius" size="size-10" />
            </Variant>
          </Item>
        </section>

        {/* ---- Cartes ---- */}
        <section className="space-y-3">
          <SectionEyebrow title="Cartes (EntityCard)" />
          <p className="text-xs text-neutral-500 -mt-1">
            Une seule carte pour géoloc / bounty / détection, en 2 dispositions.
            Modèle de clic uniforme: toute la carte mène au détail; l’auteur et
            les actions restent cliquables. Les champs absents (coords pour une
            bounty, « working » pour une géoloc) ne s’affichent pas.
          </p>

          <Item name="<EntityCard variant=feed>" usage="Flux (timeline), pour les 3 types">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="feed"
                detailHref="/geolocations/demo"
                title={MOCK_CARD_GEO.title}
                titleText={MOCK_CARD_GEO.title}
                badge={<StatusBadge status="detected" />}
                mediaSeed="pal-feed"
                author={MOCK_CARD_GEO.author}
                date={MOCK_CARD_GEO.event_date}
                coords={{ lat: 48.0159, lng: 37.8024 }}
                tags={MOCK_CARD_GEO.tags}
              />
            </div>
          </Item>

          <Item name="<EntityCard variant=compact> — géoloc" usage="Listes (profil « recent submissions »)">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="compact"
                detailHref="/geolocations/demo"
                title={MOCK_CARD_GEO.title}
                titleText={MOCK_CARD_GEO.title}
                badge={<StatusBadge status="submitted" />}
                mediaSeed="pal-compact"
                author={MOCK_CARD_GEO.author}
                date={MOCK_CARD_GEO.event_date}
                coords={{ lat: 48.0159, lng: 37.8024 }}
                tags={MOCK_CARD_GEO.tags}
              />
            </div>
          </Item>

          <Item name="<EntityCard variant=compact> — bounty" usage="/bounties + résultats de recherche">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="compact"
                detailHref="/bounties/demo"
                title="Footage demandé près de Bakhmut"
                titleText="Footage demandé près de Bakhmut"
                badge={<BountyStatusBadge status="open" />}
                mediaSeed="pal-bounty"
                author={{ username: "analyst" }}
                date="2026-05-01"
                source={{ url: "https://t.me/channel/4242", isDemo: false }}
                working={3}
                tags={MOCK_TAGS}
              />
            </div>
          </Item>

          <Item name="<EntityCard variant=compact> — détection (sans média)" usage="File de détections: clic → édition; placeholder « no media »">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="compact"
                detailHref="/geolocations/demo/edit"
                title={MOCK_DETAIL.title}
                titleText={MOCK_DETAIL.title}
                badge={<StatusBadge status="detected" />}
                author={{ username: MOCK_DETAIL.author.username }}
                date={MOCK_DETAIL.event_date}
                coords={{ lat: MOCK_DETAIL.lat, lng: MOCK_DETAIL.lng }}
                tags={MOCK_DETAIL.tags}
              />
            </div>
          </Item>
        </section>

        {/* ---- Composites ---- */}
        <section className="space-y-3">
          <SectionEyebrow title="Composites" />

          <Item name="<CuratedTagsError>" usage="Formulaires submit & edit (tags curés non chargés)">
            <div className="w-full max-w-xl">
              <CuratedTagsError onRetry={() => {}} />
            </div>
          </Item>

          <Item name="<PageLoading> / <PageError>" usage="États plein écran avant données (pages détail, listes)">
            <p className="text-xs text-neutral-500">
              Plein écran (centré via <code className="text-neutral-400">PageCenter</code>): un{" "}
              <span className="text-neutral-400">Loading…</span> muet, ou un message d’erreur
              avec lien « Back to map » optionnel. Non rendu ici (prend toute la hauteur).
            </p>
          </Item>

          <Item name="<GeolocationDetailBody>" usage="Page détail géoloc + panneau carte (variant page/panel)">
            <div className="w-full max-w-2xl space-y-4">
              <GeolocationDetailBody geo={MOCK_DETAIL} variant="page" />
            </div>
          </Item>

          <Item name="<TagPicker>" usage="Sélection de tags curés + tags libres (submit / edit)">
            <div className="w-full max-w-2xl">
              <TagPicker
                tags={tpTags}
                setTags={setTpTags}
                curatedTags={MOCK_CURATED}
                selectedTagIds={tpSelected}
                setSelectedTagIds={setTpSelected}
              />
            </div>
          </Item>

          <Item
            name="Non rendus (état runtime requis)"
            usage="Genuinement impraticables à mocker ici"
          >
            <ul className="text-[11px] text-neutral-500 space-y-1 list-disc pl-4">
              <li><span className="font-mono text-neutral-400">FileManager / MediaManager</span> — upload: a besoin de vrais fichiers en attente</li>
              <li><span className="font-mono text-neutral-400">ClosedBetaBanner</span> — bannière <code>position: fixed</code> (déjà visible en bas-droit)</li>
              <li><span className="font-mono text-neutral-400">PageShell / PageFrame</span> — ossature de page (celle de cette page)</li>
            </ul>
          </Item>
        </section>
      </div>
    </PageShell>
  );
}

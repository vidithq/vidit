"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { AtSign, Mail, MessageCircle, MapPin } from "lucide-react";

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
import { FilterChip } from "@/components/ui/FilterChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { TagBadge } from "@/components/ui/TagBadge";
import { TagChip } from "@/components/ui/TagChip";
import { Avatar } from "@/components/ui/Avatar";
import { MediaThumb } from "@/components/ui/MediaThumb";
import { CuratedTagsError } from "@/components/geolocations/CuratedTagsError";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { DeleteReceipt } from "@/components/ui/DeleteReceipt";
import MediaPlaceholder from "@/components/ui/MediaPlaceholder";
import { OptionalHint } from "@/components/ui/OptionalHint";
import FieldHelp from "@/components/ui/FieldHelp";
import SourceLabel from "@/components/ui/SourceLabel";
import StatusBadge from "@/components/geolocation/StatusBadge";
import BountyStatusBadge from "@/components/bounty/BountyStatusBadge";
import {
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  DANGER_BUTTON,
  GHOST_BUTTON_ACCENT,
  GHOST_BUTTON_DANGER,
  GHOST_BUTTON_NEUTRAL,
  NEUTRAL_BUTTON,
  TEXT_LINK,
  MUTED_LINK,
  TAPPABLE_HOVER,
  FILTER_CHIP_ACTIVE,
  FILTER_CHIP_INACTIVE,
  BETA_PILL,
  WARNING_CALLOUT,
} from "@/components/ui/styles";
import { ProofSection } from "@/components/ui/ProofSection";
import {
  FORM_LABEL,
  FORM_LABEL_COMPACT,
  FORM_INVALID_FIELD,
  FORM_ERROR_BANNER,
  FORM_ERROR_BANNER_COMPACT,
  FORM_ERROR_BANNER_BOXED,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";
import { Input } from "@/components/ui/Input";

/**
 * Living style guide: every reusable primitive, its variants, and a one-line
 * note on where it's used. Dev reference, not linked in the nav. Ordered the way
 * design systems are (atomic design): foundations / tokens, then atoms,
 * molecules, organisms, and page scaffolding. Everything follows the accent
 * palette (switchable in Settings → Display).
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
  title: "Strike on a depot, Donetsk",
  lat: 48.0159,
  lng: 37.8024,
  event_date: "2026-05-09",
  is_demo: true,
  status: "submitted",
  author: {
    id: "a1",
    username: "analyst",
    is_trusted: true,
    trust_reason: "Verified analyst",
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
  title: "Strike on a depot near Donetsk",
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
  // Dev reference only: a 404 in production / preview builds.
  if (process.env.NODE_ENV !== "development") notFound();

  const [chip, setChip] = useState(true);
  const [fc, setFc] = useState("All");
  const [tpTags, setTpTags] = useState<Tag[]>([
    { id: "f1", name: "donetsk", category: "free" },
  ]);
  const [tpSelected, setTpSelected] = useState<string[]>([]);

  return (
    <PageShell
      title="Palette"
      subtitle="Reusable building blocks, ordered smallest to largest (atomic design): foundations → atoms → molecules → organisms → pages. Everything follows the accent color (Settings → Display)."
    >
      <div className="space-y-8">
        {/* ============ FOUNDATIONS · accent & buttons ============ */}
        <section className="space-y-3">
          <SectionEyebrow title="Foundations · accent & buttons" />

          <Item name="PRIMARY_BUTTON" usage="Primary CTA: Submit, auth, admin actions">
            <button className={`px-3 py-1.5 rounded-md text-xs font-medium ${PRIMARY_BUTTON}`}>
              Primary action
            </button>
          </Item>

          <Item name="SECONDARY_BUTTON" usage="Outlined accent, transparent at rest: Edit profile, alternate actions">
            <button className={`px-3 py-1.5 rounded-md text-xs font-medium ${SECONDARY_BUTTON}`}>
              Secondary action
            </button>
          </Item>

          <Item name="DANGER_BUTTON" usage="Filled red destructive action: admin hard delete">
            <button className={`px-3 py-1.5 rounded-md text-xs font-medium ${DANGER_BUTTON}`}>
              Hard delete
            </button>
          </Item>

          <Item name="GHOST_BUTTON_ACCENT / _DANGER / _NEUTRAL" usage="Borderless row actions (admin grant / revoke / soft-delete), tint on hover">
            <button className={`px-2 py-1 rounded-md text-xs ${GHOST_BUTTON_ACCENT}`}>Grant trust</button>
            <button className={`px-2 py-1 rounded-md text-xs ${GHOST_BUTTON_DANGER}`}>Revoke</button>
            <button className={`px-2 py-1 rounded-md text-xs ${GHOST_BUTTON_NEUTRAL}`}>Soft delete</button>
          </Item>

          <Item name="NEUTRAL_BUTTON" usage="Bordered neutral button: Cancel, search submit, Following, reapers">
            <button className={`px-3 py-1.5 rounded-md text-xs ${NEUTRAL_BUTTON}`}>Neutral action</button>
          </Item>

          <Item name="TEXT_LINK" usage="Accent links: bylines, retry, empty-state CTAs">
            <a href="#" className={TEXT_LINK} onClick={(e) => e.preventDefault()}>
              A text link
            </a>
          </Item>

          <Item name="MUTED_LINK" usage="Neutral secondary nav: Cancel, Back, dismiss, × close">
            <a href="#" className={`text-sm ${MUTED_LINK}`} onClick={(e) => e.preventDefault()}>
              Cancel
            </a>
          </Item>

          <Item name="FILTER_CHIP_ACTIVE / _INACTIVE" usage="Selected-state colour pair (see <FilterChip>)">
            <Variant label="active">
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${FILTER_CHIP_ACTIVE}`}>
                Selected
              </span>
            </Variant>
            <Variant label="inactive">
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${FILTER_CHIP_INACTIVE}`}>
                Neutral
              </span>
            </Variant>
          </Item>

          <Item name="TAPPABLE_HOVER" usage="Clickable cards/rows: accent border on hover">
            <div className={`px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-md text-xs text-neutral-300 ${TAPPABLE_HOVER}`}>
              Hover me
            </div>
          </Item>

          <Item name="BETA_PILL" usage="Closed beta banner (bottom-right corner)">
            <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-medium ${BETA_PILL}`}>
              <span className="size-1.5 rounded-full bg-orange-500" />
              Closed beta
            </span>
          </Item>

          <Item name="WARNING_CALLOUT" usage="Amber caution surface: duplicate probe, tag-load failure, import notice">
            <div className={`rounded-lg px-4 py-3 text-sm ${WARNING_CALLOUT}`}>
              Heads up, check this before submitting.
            </div>
          </Item>
        </section>

        {/* ============ FOUNDATIONS · form fields ============ */}
        <section className="space-y-3">
          <SectionEyebrow title="Foundations · form fields" />

          <Item name="<Input>" usage="The one form field: variant (default / compact / locked) + invalid. Native props + className pass through.">
            <div className="w-full max-w-sm space-y-2">
              <Variant label="default">
                <Input placeholder="Type here..." />
              </Variant>
              <Variant label='variant="compact" (admin rows)'>
                <Input variant="compact" placeholder="Compact" />
              </Variant>
              <Variant label='variant="locked" (read-only)'>
                <Input variant="locked" value="Locked" readOnly />
              </Variant>
              <Variant label="invalid">
                <Input invalid placeholder="Invalid field" />
              </Variant>
            </div>
          </Item>

          <Item name="FORM_LABEL (+ _COMPACT)" usage="Field labels, kept separate from <Input>">
            <div className="space-y-2">
              <label className={FORM_LABEL}>Field label</label>
              <label className={FORM_LABEL_COMPACT}>Compact label</label>
            </div>
          </Item>

          <Item name="FORM_INVALID_FIELD" usage="Red outline token. <Input invalid> uses it; section cards apply it directly.">
            <div className={`w-full max-w-sm rounded-md border border-neutral-700 bg-neutral-900 p-3 text-xs text-neutral-400 ${FORM_INVALID_FIELD}`}>
              A section card flagged as missing.
            </div>
          </Item>

          <Item name="FORM_ERROR_BANNER (+ _COMPACT / _BOXED)" usage="Form error above actions; compact (auth) and boxed (admin) variants">
            <div className="w-full max-w-sm space-y-2">
              <Variant label="default (form)">
                <div className={FORM_ERROR_BANNER}>Something went wrong.</div>
              </Variant>
              <Variant label="_COMPACT (auth card)">
                <div className={FORM_ERROR_BANNER_COMPACT}>Something went wrong.</div>
              </Variant>
              <Variant label="_BOXED (admin panel)">
                <div className={FORM_ERROR_BANNER_BOXED}>Something went wrong.</div>
              </Variant>
            </div>
          </Item>

          <Item name="FORM_SUCCESS_BANNER" usage="Confirmation / info notice (password updated, reset). Orange, not green.">
            <div className={`${FORM_SUCCESS_BANNER} max-w-sm`}>Saved.</div>
          </Item>

          <Item name="<IncompleteFormNotice>" usage="Lists all unmet required fields at once (submit / validate / bounty)">
            <div className="w-full max-w-sm">
              <IncompleteFormNotice missing={["Coordinates", "Conflict tag", "Proof"]} />
            </div>
          </Item>
        </section>

        {/* ============ ATOMS ============ */}
        <section className="space-y-3">
          <SectionEyebrow title="Atoms" />

          <Item name="<Pill>" usage="Shared shape of every badge below (StatusBadge, BountyStatusBadge, TagBadge)">
            <Variant label="tone + icon">
              <Pill tone="bg-orange-500/15 text-orange-400 border border-orange-500/30">
                Accent
              </Pill>
            </Variant>
            <Variant label="neutral tone">
              <Pill tone="bg-neutral-700/40 text-neutral-300 border border-neutral-600/50">
                Neutral
              </Pill>
            </Variant>
          </Item>

          <Item name="<TagBadge>" usage="Decorative tags on cards & detail pages (the TAG_CHIP tone)">
            {MOCK_TAGS.map((t) => (
              <TagBadge key={t.id} name={t.name} />
            ))}
          </Item>

          <Item name="<StatusBadge>" usage="Geoloc status: cards, detail, detections queue">
            <StatusBadge status="detected" />
            <StatusBadge status="submitted" />
          </Item>

          <Item name="<BountyStatusBadge>" usage="Bounty status, the STATUS_PILL_ACTIVE / STATUS_PILL_FULFILLED / STATUS_PILL_CLOSED tones: list & detail">
            <BountyStatusBadge status="open" />
            <BountyStatusBadge status="fulfilled" />
            <BountyStatusBadge status="closed" />
          </Item>

          <Item name="<TagChip>" usage="Tag selection (TagPicker, forms)">
            <TagChip tag={{ id: "x", name: "Clickable", category: "free" }} active={chip} onClick={() => setChip((v) => !v)} />
            <span className="text-[11px] text-neutral-600 self-center">← click</span>
          </Item>

          <Item name="<FieldHelp> + <OptionalHint>" usage="Help ? on labels/sections + optional marker">
            <span className="inline-flex items-center gap-1 text-sm text-neutral-300">
              Coordinates <FieldHelp concept="coordinates" /> <OptionalHint />
            </span>
          </Item>

          <Item name="<SourceLabel>" usage="Source display (shortened host, or synthetic in demo)">
            <SourceLabel isDemo={false} url="https://t.me/some_channel/4242" variant="inline" />
            <SourceLabel isDemo url="synthetic://demo" variant="inline" />
          </Item>

          <Item name="<MediaThumb>" usage="Thumbnail on bounty cards (list & search)">
            <MediaThumb />
          </Item>

          <Item name="<MediaPlaceholder>" usage="Generated stand-in for cards with no real media (deterministic shade per seed)">
            {["alpha", "donetsk", "x-4242"].map((seed) => (
              <div key={seed} className="relative w-24 aspect-video rounded-md overflow-hidden bg-neutral-800">
                <MediaPlaceholder seed={seed} />
              </div>
            ))}
          </Item>

          <Item name="<Avatar>" usage="Profile header (icon) + user search results (initial)">
            <Variant label='fallback="icon"'>
              <Avatar username="demo" size="w-16 h-16" fallback="icon" />
            </Variant>
            <Variant label='fallback="initial"'>
              <Avatar username="Marius" size="size-10" />
            </Variant>
          </Item>
        </section>

        {/* ============ MOLECULES ============ */}
        <section className="space-y-3">
          <SectionEyebrow title="Molecules" />

          <Item name="<FilterChip>" usage="Bounties status filter + search type filter">
            {["All", "Open", "Closed"].map((label) => (
              <FilterChip key={label} active={fc === label} onClick={() => setFc(label)}>
                {label}
              </FilterChip>
            ))}
          </Item>

          <Item name="<LinkRow>" usage="Linked accounts (profile) + Stay in touch (About)">
            <div className="w-full max-w-md space-y-2">
              <LinkRow icon={AtSign} label="X / Twitter" value="@vidithq" href="https://x.com/vidithq" />
              <LinkRow icon={Mail} label="Email" value="hello@vidit.app" href="mailto:hello@vidit.app" external={false} />
              <LinkRow icon={MessageCircle} label="Discord" value="a-handle (unresolved)" />
            </div>
          </Item>

          <Item name="<EmptyState>" usage="Empty lists: bounties, search">
            <EmptyState className="max-w-sm">
              Nothing here yet.{" "}
              <a href="#" className={TEXT_LINK} onClick={(e) => e.preventDefault()}>
                Create the first one
              </a>
              .
            </EmptyState>
          </Item>

          <Item name="<SectionHeading>" usage="Form section heading (Details, Location, Tags...)">
            <SectionHeading title="Source media" concept="source_media" />
            <SectionHeading title="Proof" concept="section_proof" optional />
          </Item>

          <Item name="<SectionEyebrow>" usage="Detail page + card/panel headings (uppercase eyebrow)">
            <Variant label="as=h2 (page)">
              <SectionEyebrow title="Details" concept="section_details" />
            </Variant>
            <Variant label="no concept">
              <SectionEyebrow title="Working on" />
            </Variant>
          </Item>
        </section>

        {/* ============ ORGANISMS ============ */}
        <section className="space-y-3">
          <SectionEyebrow title="Organisms" />

          <Item name="<Card>" usage="Panels: settings, admin, profile, form sections. One rhythm (space-y-4) for all.">
            <Card className="w-48">
              <p className="text-xs text-neutral-300">Content</p>
              <p className="text-xs text-neutral-500">Second line</p>
            </Card>
          </Item>

          <Item name="<DetailCard> + <DetailRow>" usage="Geoloc & bounty detail pages (label / value)">
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

          <Item name="<DeleteReceipt>" usage="Admin delete result (trust panel, geolocation delete)">
            <div className="w-full max-w-md space-y-2">
              <DeleteReceipt
                icon={<MapPin size={12} className="text-orange-400" />}
                label="Strike on a depot"
                mode="hard"
                modeTone="border-red-500/30 text-red-300"
              >
                <div className="text-neutral-500">Swept 3 media + 1 proof image.</div>
              </DeleteReceipt>
              <DeleteReceipt
                label="@analyst"
                mode="soft"
                modeTone="border-amber-500/30 text-amber-300"
              >
                <div className="text-neutral-500">Cascade-hid 2 geolocations.</div>
              </DeleteReceipt>
            </div>
          </Item>

          <Item name="<ProofSection>" usage="Proof section on geoloc + bounty detail: eyebrow + bordered box">
            <div className="w-full max-w-xl">
              <ProofSection>
                <div className="text-sm text-neutral-300 leading-relaxed">
                  The proof body goes here (a rendered doc, or bounty notes).
                </div>
              </ProofSection>
            </div>
          </Item>

          <Item name="<EntityCard variant=feed>" usage="Feed (timeline), for all 3 types">
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

          <Item name="<EntityCard variant=compact>: geoloc" usage="Lists (profile recent submissions)">
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

          <Item name="<EntityCard variant=compact>: bounty" usage="/bounties + search results">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="compact"
                detailHref="/bounties/demo"
                title="Footage wanted near Bakhmut"
                titleText="Footage wanted near Bakhmut"
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

          <Item name="<EntityCard variant=compact>: detection (no media)" usage="Detections queue: click leads to edit; no-media placeholder">
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

          <Item name="<CuratedTagsError>" usage="Submit & edit forms (curated tags failed to load)">
            <div className="w-full max-w-xl">
              <CuratedTagsError onRetry={() => {}} />
            </div>
          </Item>

          <Item name="<TagPicker>" usage="Curated + free tag selection (composes NewTagInput + TagChip); submit / edit">
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

          <Item name="<GeolocationDetailBody>" usage="Geoloc detail page + map panel (page/panel variant)">
            <div className="w-full max-w-2xl space-y-4">
              <GeolocationDetailBody geo={MOCK_DETAIL} variant="page" />
            </div>
          </Item>
        </section>

        {/* ============ PAGES & scaffolding ============ */}
        <section className="space-y-3">
          <SectionEyebrow title="Pages & scaffolding" />

          <Item name="<PageLoading> / <PageError>" usage="Full-screen states before data (detail pages, lists)">
            <p className="text-xs text-neutral-500">
              Full-screen (centered via <code className="text-neutral-400">PageCenter</code>): a quiet{" "}
              <span className="text-neutral-400">Loading…</span>, or an error message
              with an optional Back to map link. Not rendered here (takes the full height).
            </p>
          </Item>

          <Item name="Not rendered (runtime state required)" usage="Genuinely impractical to mock here">
            <ul className="text-[11px] text-neutral-500 space-y-1 list-disc pl-4">
              <li><span className="font-mono text-neutral-400">FileManager / MediaManager</span>: upload, needs real pending files</li>
              <li><span className="font-mono text-neutral-400">ClosedBetaBanner</span>: a <code>position: fixed</code> banner, already visible bottom-right</li>
              <li><span className="font-mono text-neutral-400">Sidebar</span>: fixed nav rail, auth/route-driven, always on screen</li>
              <li><span className="font-mono text-neutral-400">PageShell / PageFrame</span>: page scaffolding, this very page</li>
            </ul>
          </Item>
        </section>
      </div>
    </PageShell>
  );
}

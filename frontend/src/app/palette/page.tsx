"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import {
  Archive,
  AtSign,
  BookOpen,
  Bot,
  Check,
  Circle,
  Copy,
  Download,
  ExternalLink,
  Film,
  Mail,
  MapPin,
  MessageCircle,
  Search as SearchIcon,
  Upload,
} from "lucide-react";

import type { Conflict, EventDetail, EventStatus, Media, Tag } from "@/types";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import {
  DiscordGlyph,
  GitHubGlyph,
  XGlyph,
} from "@/components/ui/BrandGlyphs";
import { TagPicker } from "@/components/ui/TagPicker";
import { EntityCard } from "@/components/ui/EntityCard";
import { DetectionQueueRow } from "@/components/detections/DetectionQueueRow";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { LinkRow } from "@/components/ui/LinkRow";
import { StatTile, StatGrid } from "@/components/ui/StatTile";
import { ActivityHeatmap } from "@/components/ui/ActivityHeatmap";
import { SourceHostBar } from "@/components/ui/SourceHostBar";
import { NumberedSteps } from "@/components/ui/NumberedSteps";
import {
  MOCK_ANALYST,
  MOCK_BOT,
  MockPost,
  MockPostLink,
} from "@/components/ui/MockPost";
import { ProgressSteps } from "@/components/ui/ProgressSteps";
import { ActiveFilterPills } from "@/components/ui/ActiveFilterPills";
import { ChipBucket } from "@/components/ui/ChipBucket";
import { FilterSection, chipSummary } from "@/components/ui/FilterSection";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar } from "@/components/ui/Avatar";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Dot } from "@/components/ui/Dot";
import { GraphicContentGate } from "@/components/ui/GraphicContentGate";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { CuratedTagsError } from "@/components/geolocations/CuratedTagsError";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { SourceLabel } from "@/components/ui/SourceLabel";
import {
  ArchiveAdornment,
  ArchivedCopies,
  ArchiveSnapshotField,
  DETECTED_FROM_DESCRIPTION,
  PRIMARY_SOURCE_DESCRIPTION,
  mirrorDescription,
} from "@/components/ui/ArchivedCopies";
import { StatusBadge } from "@/components/event/StatusBadge";
import {
  TEXT_LINK,
  TAPPABLE_HOVER,
  ACCENT_SURFACE,
  ACCENT_RAMP,
  CHART_TAIL,
  CHART_NEUTRAL,
  HOVER_REVEAL,
  ARMED_RING,
  WARNING_CALLOUT,
} from "@/components/ui/styles";
import { Button, buttonClasses, DANGER_CONFIRM } from "@/components/ui/Button";
import { CoordinateActions } from "@/components/event/CoordinateActions";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { ProofSection } from "@/components/ui/ProofSection";
import {
  FORM_LABEL,
  FORM_LABEL_COMPACT,
  FORM_INVALID_FIELD,
  FORM_INVALID_LABEL,
  FORM_ERROR_BANNER,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";
import { Input, Select } from "@/components/ui/Input";
import { LinkListInput } from "@/components/ui/LinkListInput";
import { safeHostname } from "@/lib/format";

/**
 * Living style guide: every reusable primitive, its variants, and a one-line
 * note on where it's used. Dev reference, not linked in the nav. Grouped by what
 * you're building (tokens, controls, forms, content, containers, views) rather
 * than by an abstraction level, so related pieces sit together. Everything
 * follows the accent palette (switchable in Settings → Display).
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

// A full geolocation, for the detail body + detection card.
const MOCK_DETAIL: EventDetail = {
  id: "demo",
  title: "Strike on a depot, Donetsk",
  event_coords: { lat: 48.0159, lng: 37.8024 },
  capture_source_coords: null,
  archived_source: null,
  event_date: "2026-05-09",
  is_graphic: false,
  status: "geolocated",
  version_no: 1,
  close_reason: null,
  before_closed_status: null,
  owner: {
    id: "a1",
    username: "analyst",
    avatar_url: null,
  },
  tags: [
    { id: "t2", name: "Drone", category: "capture_source" },
    { id: "t3", name: "Donetsk", category: "free" },
  ],
  conflicts: [
    {
      id: "c1",
      name: "Russian invasion of Ukraine",
      wikidata_id: null,
      start_year: 2022,
      end_year: null,
      ongoing: true,
      tier: "major",
    },
  ],
  source_url: "https://t.me/channel/4242",
  // Two mirrors so the detail body's collapsed Secondary sources row shows.
  secondary_source_urls: [
    "https://t.me/mirror/1",
    "https://www.youtube.com/watch?v=mirror2",
  ],
  archived_secondary_sources: [null, null],
  event_time: "15:45:00",
  source_posted_at: "2026-05-09T15:45:00Z",
  detected_from_url: null,
  detected_via: null,
  archived_detected_from: null,
  detected_post_at: null,
  proof: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  requested_at: null,
  detected_at: null,
  geolocated_at: "2026-06-01T00:00:00Z",
  closed_at: null,
  media: [],
  thumbnail: null,
  requested_by: null,
  geolocators: [],
};

// The three badge states a Detections queue row can be in: the detection that
// carries the whole evidence floor and is waiting on a review's judgment, the
// one short of a single named piece, and the one short of several, which
// collapse to a count.
const MOCK_DETECTION_READY: EventDetail = {
  ...MOCK_DETAIL,
  id: "detection-ready",
  status: "detected",
  source_url: "https://t.me/channel/12345",
  proof: { type: "doc", content: [{ type: "image", attrs: { src: "" } }] },
  media: [
    {
      id: "m1",
      storage_url: "/local-storage/demo.jpg",
      media_type: "image",
      role: "source",
    },
  ],
};

const MOCK_DETECTION_ONE_MISSING: EventDetail = {
  ...MOCK_DETECTION_READY,
  id: "detection-one-missing",
  title: "Convoy on a rural road, unnamed",
  proof: null,
};

const MOCK_DETECTION_SEVERAL_MISSING: EventDetail = {
  ...MOCK_DETECTION_ONE_MISSING,
  id: "detection-several-missing",
  title: "Smoke over a treeline, location unclear",
  media: [],
  source_url: null,
};

// The same detail body with a real source captured at both providers, a
// provenance link archived at archive.today, plus one mirror archived and one
// with no copy yet.
const MOCK_DETAIL_ARCHIVED: EventDetail = {
  ...MOCK_DETAIL,
  source_url: "https://t.me/channel/12345",
  archived_source: {
    url: "https://web.archive.org/web/20260601120000/https://t.me/channel/12345",
    provider: "wayback",
  },
  detected_from_url: "https://x.com/analyst/status/1234567890",
  archived_detected_from: { url: "https://archive.ph/fghij", provider: "archive_today" },
  archived_secondary_sources: [
    {
      url: "https://web.archive.org/web/20260601120100/https://t.me/mirror/1",
      provider: "wayback",
    },
    null,
  ],
};

// The lighter geolocation-card payload (timeline / recent-submissions shape).
const MOCK_CARD_GEO = {
  id: "demo",
  title: "Strike on a depot near Donetsk",
  event_date: "2026-05-09",
  status: "detected" as EventStatus,
  lat: 48.0159,
  lng: 37.8024,
  owner: { username: "analyst" },
  tags: [
    { id: "t2", name: "Drone", category: "capture_source" as const },
    { id: "t3", name: "Donetsk", category: "free" as const },
  ],
};

const MOCK_CURATED: Tag[] = [
  { id: "cs1", name: "Drone", category: "capture_source" },
  { id: "cs2", name: "Satellite", category: "capture_source" },
];

// A small slice of the conflicts referential for the TagPicker's typeahead:
// a major and a minor ongoing entry, an ended one (searchable behind the
// switch), and the "Other" escape row (tier none, pinned last).
const MOCK_CONFLICTS: Conflict[] = [
  {
    id: "c1",
    name: "Russian invasion of Ukraine",
    wikidata_id: null,
    start_year: 2022,
    end_year: null,
    ongoing: true,
    tier: "major",
  },
  {
    id: "c2",
    name: "Sudanese civil war",
    wikidata_id: null,
    start_year: 2023,
    end_year: null,
    ongoing: true,
    tier: "minor",
  },
  {
    id: "c3",
    name: "Falklands War",
    wikidata_id: null,
    start_year: 1982,
    end_year: 1982,
    ongoing: false,
    tier: null,
  },
  {
    id: "c4",
    name: "Other",
    wikidata_id: null,
    start_year: null,
    end_year: null,
    ongoing: true,
    tier: null,
  },
];

export default function PalettePage() {
  // Dev reference only: a 404 in production / preview builds.
  if (process.env.NODE_ENV !== "development") notFound();

  const [pillSel, setPillSel] = useState("Open");
  const [segSel, setSegSel] = useState<"single" | "bulk">("single");
  const [segMode, setSegMode] = useState<"soft" | "hard">("soft");
  const [swOn, setSwOn] = useState(true);
  const [tpTags, setTpTags] = useState<Tag[]>([
    { id: "f1", name: "donetsk", category: "free" },
  ]);
  const [tpSelected, setTpSelected] = useState<string[]>([]);
  const [tpConflictSel, setTpConflictSel] = useState<string[]>([]);
  const [links, setLinks] = useState<string[]>(["https://t.me/channel/12345"]);
  const [linkCopies, setLinkCopies] = useState<string[]>([""]);

  return (
    <PageShell
      title="Palette"
      subtitle="Reusable building blocks, grouped by what you're building: tokens → controls → forms → content → containers → views. Everything follows the accent color (Settings → Display)."
    >
      <div className="space-y-8">
        {/* ============ TOKENS ============ */}
        {/* The raw class strings you compose with, not components. */}
        <section className="space-y-3">
          <SectionEyebrow title="Tokens" />

          <Item name="ACCENT_SURFACE" usage="The base accent surface paint (bg + text), the single source shared by the <Pill> accent tone (which layers a border on top) and the active nav / row treatments (Sidebar, landing, submit) that want the same fill without a pill border.">
            <Variant label="active nav">
              <span className={`px-2.5 py-1 rounded-md text-[11px] font-medium ${ACCENT_SURFACE}`}>
                Active
              </span>
            </Variant>
          </Item>

          <Item name="ACCENT_RAMP / CHART_TAIL / CHART_NEUTRAL" usage="The chart scale: the accent as five intensity steps, strongest first, plus the two paints outside it. CHART_TAIL is work under a name the chart does not print (<SourceHostBar>'s Other); CHART_NEUTRAL is absence (an empty month, a slice naming no source). One hue, because both charts order by magnitude, so a hue per category would invent a palette to say what position already says. <ActivityHeatmap> uses the four strongest steps only: the faintest reads as noise beside an empty cell. The ramp is the site's one sanctioned inert accent: a mark whose step encodes a magnitude carries it whether or not a reader can act on it, and so does its legend. The bar's ranked segments and the grid's lit months are both inert ranked marks; both take the ramp, and what stands outside the ranking takes CHART_TAIL or CHART_NEUTRAL.">
            <div className="flex flex-wrap items-center gap-3">
              <Variant label="ACCENT_RAMP">
                <span className="flex gap-1">
                  {ACCENT_RAMP.map((paint) => (
                    <span key={paint} className={`size-5 rounded-xs ${paint}`} />
                  ))}
                </span>
              </Variant>
              <Variant label="CHART_TAIL">
                <span className={`size-5 rounded-xs ${CHART_TAIL}`} />
              </Variant>
              <Variant label="CHART_NEUTRAL">
                <span className={`size-5 rounded-xs ${CHART_NEUTRAL}`} />
              </Variant>
            </div>
          </Item>

          <Item name="TEXT_LINK" usage="Accent links: bylines, retry, empty-state CTAs">
            <a href="#" className={TEXT_LINK} onClick={(e) => e.preventDefault()}>
              A text link
            </a>
          </Item>

          <Item name="TAPPABLE_HOVER" usage="A whole card / section is one click target: accent border on hover. Pair `group` + `group-hover:text-orange-400` so the title takes the accent too.">
            <div className="w-full max-w-md space-y-2">
              <Variant label="compact row">
                <div className={`px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-md text-xs text-neutral-300 ${TAPPABLE_HOVER}`}>
                  Hover me
                </div>
              </Variant>
              <Variant label="full section (group + group-hover title)">
                <div className={`group block px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg ${TAPPABLE_HOVER}`}>
                  <h4 className="text-sm font-medium text-neutral-100 group-hover:text-orange-400 transition-colors">
                    A whole clickable section
                  </h4>
                  <p className="text-xs text-neutral-500 mt-1">
                    The entire panel is the click target. The border turns orange and the title picks up the accent on hover.
                  </p>
                </div>
              </Variant>
            </div>
          </Item>

          <Item name="ARMED_RING" usage="The armed half of a two-click confirm on a control that stays put: a ring plus a neutral plate, so the button reads as changed without moving or resizing anything. Applied via className over any variant, paired with useConfirmAction (which owns the arming, the timeout, and the Escape / outside-click exits) and a label that says what the next click does. Every armed control that is not the loud red point of no return uses it: the event share row's detection link, the detection form's Submit. DANGER_CONFIRM is the destructive counterpart.">
            <div className="flex items-center gap-3">
              <Button variant="primary" className={ARMED_RING}>
                Confirm submit
              </Button>
              <Button icon variant="ghost" className={ARMED_RING} aria-label="Copy coordinates" title="Copy coordinates">
                <Copy size={15} />
              </Button>
            </div>
          </Item>

          <Item name="WARNING_CALLOUT" usage="Amber caution surface: duplicate probe, tag-load failure, import notice, admin armed confirms. Colour only; callers add rounded-md + their own padding.">
            <div className={`rounded-md px-4 py-3 text-sm ${WARNING_CALLOUT}`}>
              Heads up, check this before submitting.
            </div>
          </Item>
        </section>

        {/* ============ CONTROLS · buttons & pills ============ */}
        {/* The two tone systems (<Button> / <Pill>) and the pills' consumers. */}
        <section className="space-y-3">
          <SectionEyebrow title="Controls · buttons & pills" />

          <Item name="<Button>" usage="Two axes: tone (accent / danger) and emphasis (filled → outline → text). Everything clickable is the accent colour, red is destructive or alerting, no grey button. `dangerGhost` is red at ghost weight, for a red control sitting in an icon row (the report flag). `icon` makes a square icon-only button, the one icon control on the site; `buttonClasses` puts the same shape on a <Link> or an <a> that navigates; `DANGER_CONFIRM` is the one loud filled red, applied only to the armed two-click confirm. `disabled` drops the tone for neutral grey rather than fading it, so a button that refuses the click reads like every other inert control on the site.">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
                <Button variant="dangerGhost">Danger ghost</Button>
                <Button icon variant="ghost" aria-label="Locate" title="Locate">
                  <MapPin size={15} />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-neutral-600 self-center">disabled:</span>
                <Button variant="primary" disabled>Primary</Button>
                <Button variant="secondary" disabled>Secondary</Button>
                <Button variant="ghost" disabled>Ghost</Button>
                <Button variant="danger" disabled>Danger</Button>
                <Button icon variant="ghost" disabled aria-label="Locate" title="Locate">
                  <MapPin size={15} />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-neutral-600 self-center">two-click confirm:</span>
                <Button variant="danger">Delete this request</Button>
                <span className="text-neutral-600 self-center">→</span>
                <Button variant="danger" className={DANGER_CONFIRM}>
                  Confirm delete
                </Button>
              </div>
            </div>
          </Item>

          <Item name="the icon control" usage="Every icon control on the site is the ghost icon button, at one size: a page-header cluster, the profile header row, the coordinates line, the archive mark beside a source link, a field's trailing adornment, all the same 32px square with the same hover plate. An action is <Button icon variant='ghost'>; navigation is buttonClasses('ghost', {icon: true}) on a <Link> or an <a>, so a control that navigates never nests a button inside an anchor; a control with nothing to act on is the disabled button, which paints itself neutral grey and leaves the tab order (an inert link becomes a disabled button, since a dead anchor is not a control). aria-label is the whole name, title repeats it, and only a tooltip that moves while the name holds still (a copy flash) may differ. Marks are 14px lucide or brand glyphs.">
            <div className="flex items-center gap-4 text-sm text-neutral-300">
              <Variant label="action">
                <Button icon variant="ghost" aria-label="Copy coordinates" title="Copy coordinates">
                  <Copy size={14} />
                </Button>
              </Variant>
              <Variant label="navigation">
                <a
                  href="#"
                  aria-label="Wayback Machine copy of the source"
                  title="Wayback Machine copy of the source"
                  className={buttonClasses("ghost", { icon: true })}
                >
                  <Archive size={14} />
                </a>
              </Variant>
              <Variant label="inert">
                <Button
                  icon
                  variant="ghost"
                  disabled
                  aria-label="No map link until the coordinate pair is complete"
                  title="No map link until the coordinate pair is complete"
                >
                  <ExternalLink size={14} />
                </Button>
              </Variant>
            </div>
          </Item>

          <Item name="<ActiveFilterPills>" usage="The one rendering of active filters: a row of removable accent chips (label + ×), shared by the map's filter overlay and the search page so active filter state reads identically everywhere. Entries are {key, label, icon?, onRemove}; `onClearAll` adds a quiet clear-everything affordance once two or more filters are on. Renders nothing when the list is empty.">
            <PaletteActiveFilterPills />
          </Item>

          <Item name="<FilterSection>" usage="One collapsible filter section (chipSummary / rangeSummary build its collapsed one-line summary, orange when active). Open state is parent-owned (open + onToggle) so re-renders never reset the accordion; the optional `concept` wires the shared FieldHelp `?`. Shared by the map overlay and the search filter area.">
            <PaletteFilterSection />
          </Item>

          <Item name="<ChipBucket>" usage="A multi-select chip bucket for one filter family (conflicts, capture sources, tags, media types): every option a <Pill>, selected ones filled accent, click toggles membership. Any-match within the bucket; combining buckets is AND on the server.">
            <PaletteChipBucket />
          </Item>

          <Item name="<ToggleRow>" usage="A compact on/off row for a boolean filter: the whole row is the switch (role + click), the <Switch> rendering as its visual span.">
            <PaletteToggleRow />
          </Item>

          <Item name="<Pill>" usage="One pill for the whole family (status, tag, filter, badge) at one size. `tone` = accent | secondary | neutral | danger, mirroring the <Button> tones (secondary is the accent outline, no fill). A static <span> by default; pass `onClick` and it becomes an interactive chip (a <button> that brightens on hover), the caller driving the tone off its active state. className merges via cn (caller wins on a conflicting utility); keep it to orthogonal extras, the size stays one.">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-neutral-600 self-center w-12">static</span>
                <Pill tone="accent" icon={<MapPin size={11} />}>
                  accent
                </Pill>
                <Pill tone="secondary">secondary</Pill>
                <Pill tone="neutral">neutral</Pill>
                <Pill tone="danger">danger</Pill>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-neutral-600 self-center w-12">chips</span>
                {["All", "Open", "Closed"].map((label) => (
                  <Pill
                    key={label}
                    tone={pillSel === label ? "accent" : "neutral"}
                    onClick={() => setPillSel(label)}
                  >
                    {label}
                  </Pill>
                ))}
                <span className="text-[11px] text-neutral-600 self-center">← click</span>
              </div>
              {/* Readiness tick-list (submit): a met vs pending pair per tone, so
                  the marked-state loudness can be compared side by side. */}
              <div className="space-y-1.5">
                {(["accent", "secondary", "neutral"] as const).map((t) => (
                  <div key={t} className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-neutral-600 self-center w-12">
                      {t}
                    </span>
                    <Pill tone={t} icon={<Check size={12} strokeWidth={2.5} />}>
                      Coordinates
                    </Pill>
                    <Pill tone="neutral" icon={<Circle size={9} strokeWidth={2} />}>
                      Proof image
                    </Pill>
                  </div>
                ))}
              </div>
            </div>
          </Item>

          <Item name="<SegmentedControl>" usage="Exclusive-choice bar: submit mode (single / bulk import), admin delete mode (soft / hard), the detections queue filter. tone=danger paints a destructive option's active state red; fullWidth stretches the track. A one-word label that needs a sentence takes a <FieldHelp> beside the bar, never hover text of its own.">
            <div className="space-y-3">
              <SegmentedControl
                aria-label="Preview mode"
                options={[
                  { value: "single", label: "Single" },
                  { value: "bulk", label: "Bulk import" },
                ]}
                value={segSel}
                onChange={setSegSel}
              />
              <SegmentedControl
                aria-label="Preview delete mode"
                options={[
                  { value: "soft", label: "Soft delete" },
                  { value: "hard", label: "Hard delete", tone: "danger" },
                ]}
                value={segMode}
                onChange={setSegMode}
              />
            </div>
          </Item>

          <Item name="<Switch>" usage="The one boolean toggle: settings rows (md), map filter rows (sm). as='span' renders the visual only, for a parent that owns the click (whole-row toggles). disabled reads the state but refuses the toggle, for a value this surface cannot change (the edit form's ratcheted graphic-content flag).">
            <Variant label='size="md"'>
              <Switch on={swOn} onToggle={() => setSwOn(!swOn)} aria-label="Preview switch" />
            </Variant>
            <Variant label='size="sm"'>
              <Switch size="sm" on={swOn} onToggle={() => setSwOn(!swOn)} aria-label="Preview switch small" />
            </Variant>
            <Variant label="disabled">
              <Switch on disabled aria-label="Demo switch locked" />
            </Variant>
          </Item>

          <Item name="<StatusBadge>" usage="A <Pill> consumer: maps the unified event status (requested / detected / geolocated / closed) to a tone + icon + label. Cards, both detail pages, search, detections queue.">
            <StatusBadge status="requested" />
            <StatusBadge status="detected" />
            <StatusBadge status="geolocated" />
            <StatusBadge status="closed" />
          </Item>
        </section>

        {/* ============ FORMS ============ */}
        {/* Everything you touch building a form. */}
        <section className="space-y-3">
          <SectionEyebrow title="Forms" />

          <Item name="<Input> (+ FORM_INVALID_FIELD, FieldAdornment, TRAILING_ROOM)" usage="The one form field: variant (default / compact / locked) + invalid + icon + trailing. `<Input invalid>` is sugar over the FORM_INVALID_FIELD red-outline token; the same raw token flags non-input surfaces too (media dropzone, proof editor, section cards). `icon` overlays a leading icon at the leading edge, inert. `trailing` is the field's own action slot at the other edge, centred on the field's height and taking the pointer: the map and copy marks of a longitude field, the picker of a <DateTimeInput>, the archive mark of a URL field. Each one is a ghost icon button, the site's one icon control, set a hair apart so two hover plates read as two controls; the field is one height across the three variants so that 32px square sits inside any of them with a 3px gutter, and the text padding grows by TRAILING_ROOM so a long value never runs under them. FieldAdornment + TRAILING_ROOM are exported for the one field that is not an input: <LockedUrl> renders a frozen value as an anchor and clears the same adornment by the same amount. Native props + className pass through.">
            <div className="w-full max-w-sm space-y-2">
              <Variant label="default">
                <Input placeholder="Type here..." />
              </Variant>
              <Variant label="icon (search box)">
                <Input icon={<SearchIcon size={14} />} type="search" placeholder="Search…" />
              </Variant>
              <Variant label="trailing (the field's own actions)">
                <Input
                  placeholder="48.015883"
                  className="font-mono"
                  trailing={<CoordinateActions lat={48.015883} lng={37.802411} />}
                />
              </Variant>
              <Variant label='variant="compact" (admin rows)'>
                <Input variant="compact" placeholder="Compact" />
              </Variant>
              <Variant label='variant="locked" (read-only)'>
                <Input variant="locked" value="Locked" readOnly />
              </Variant>
              <Variant label="invalid (Input, = FORM_INVALID_FIELD)">
                <Input invalid placeholder="Invalid field" />
              </Variant>
              <Variant label="FORM_INVALID_FIELD raw (non-input surface)">
                <div className={`rounded-md border border-neutral-700 bg-neutral-900 p-3 text-xs text-neutral-400 ${FORM_INVALID_FIELD}`}>
                  A section card flagged as missing.
                </div>
              </Variant>
            </div>
          </Item>

          <Item name="<Select>" usage="Pick-one from a short curated list, same shapes and invalid state as <Input> (one recipe, so a select and a text field on the same row can't drift). Native <select> under a custom caret: the options are a handful of values and the platform control is what behaves on a phone. Carries the reason bucket on the report-event form. Reach for <TagPicker> chips instead when the options are a taxonomy to browse.">
            <div className="w-full max-w-sm space-y-2">
              <Variant label="default">
                <Select defaultValue="">
                  <option value="">Not now</option>
                  <option value="drone">Drone</option>
                  <option value="ground">Ground</option>
                  <option value="satellite">Satellite</option>
                </Select>
              </Variant>
              <Variant label='variant="compact" (dense table row)'>
                <Select variant="compact" defaultValue="drone">
                  <option value="drone">Drone</option>
                  <option value="ground">Ground</option>
                </Select>
              </Variant>
              <Variant label="invalid">
                <Select invalid defaultValue="">
                  <option value="">Pick a capture source</option>
                  <option value="drone">Drone</option>
                </Select>
              </Variant>
            </div>
          </Item>

          <Item name="<DateTimeInput>" usage="A date, a time or an instant: the native control wearing the site's own mark. The browser draws its picker button in engine chrome at engine size, which on the dark field reads as a foreign element; the brick sets `.picker-glyph` (globals.css hides that button, Webkit/Chromium only) and puts a ghost icon button in the field's trailing slot instead, Calendar for anything picking a day and Clock for a time of day, opening the same native picker through showPicker() and falling back to focusing the field. One brick for the event date, the event time and the source post time, on the submit form and the edit form alike. It also owns `has-value`, the class globals.css mutes an empty field's dd/mm/yyyy placeholder off, so no call site derives it. A date field too narrow for an adornment (the search filters, the map scrubber) stays a bare Input of type date and keeps the native button.">
            <div className="w-full max-w-sm space-y-2">
              <Variant label='type="date" (empty)'>
                <DateTimeInput type="date" value="" onChange={() => {}} />
              </Variant>
              <Variant label='type="time"'>
                <DateTimeInput type="time" value="14:30" onChange={() => {}} />
              </Variant>
              <Variant label='type="datetime-local"'>
                <DateTimeInput
                  type="datetime-local"
                  value="2026-06-01T14:30"
                  onChange={() => {}}
                />
              </Variant>
              <Variant label="invalid (a required field left blank)">
                <DateTimeInput type="date" value="" invalid onChange={() => {}} />
              </Variant>
            </div>
          </Item>

          <Item name="<LinkListInput>" usage="An ordered list of URL fields with a remove per row and one add button: the submit / edit forms' Secondary sources. `max` mirrors the server cap and disables add at the ceiling. Blank rows are the caller's to drop at assembly. `companion` gives every row a second value plus a mark inside the row's URL field (`trailing`) and a line under it (`render`), all three kept index-aligned through adds and removals: on the source forms that is the <ArchiveAdornment> / <ArchiveSnapshotField> pair, so a mirror is archived where it is typed. The list owns which rows are expanded for the same reason it owns the values, and a row seeded with a companion value opens showing it.">
            <div className="w-full max-w-sm space-y-4">
              <Variant label="editable (max 3 here)">
                <LinkListInput
                  values={links}
                  onChange={setLinks}
                  max={3}
                  itemLabel="Secondary source"
                  placeholder="https://x.com/user/status/12345"
                />
              </Variant>
              <Variant label="with a companion field per row">
                <LinkListInput
                  values={links}
                  onChange={setLinks}
                  max={3}
                  itemLabel="Secondary source"
                  placeholder="https://x.com/user/status/12345"
                  companion={{
                    values: linkCopies,
                    onChange: setLinkCopies,
                    trailing: ({ index, url, expanded, toggle }) => (
                      <ArchiveAdornment
                        describes={mirrorDescription(
                          safeHostname(url),
                          index,
                          links.length
                        )}
                        copy={null}
                        expanded={expanded}
                        onToggle={toggle}
                      />
                    ),
                    render: ({ index, url, value, onChange }) => (
                      <ArchiveSnapshotField
                        link={url}
                        describes={mirrorDescription(
                          safeHostname(url),
                          index,
                          links.length
                        )}
                        value={value}
                        onChange={onChange}
                      />
                    ),
                  }}
                />
              </Variant>
            </div>
          </Item>

          <Item name="FORM_LABEL (+ _COMPACT, LABEL_TEXT, FORM_INVALID_LABEL)" usage="Field labels, kept separate from <Input>. LABEL_TEXT is the bare 11px uppercase text (FORM_LABEL minus block) for block hosts: table head rows, group headings, the error-digest label. FORM_INVALID_LABEL is FORM_INVALID_FIELD's label-side companion: every required field appends it to its own label (or SectionHeading's title) alongside the input's FORM_INVALID_FIELD outline, so the two always turn red together.">
            <div className="space-y-2">
              <label className={FORM_LABEL}>Field label</label>
              <label className={FORM_LABEL_COMPACT}>Compact label</label>
              <label className={`${FORM_LABEL} ${FORM_INVALID_LABEL}`}>
                Invalid field label
              </label>
            </div>
          </Item>

          <Item name="FORM_ERROR_BANNER" usage="The one error banner above the actions: forms, auth cards, admin panels">
            <div className={`${FORM_ERROR_BANNER} max-w-sm`}>Something went wrong.</div>
          </Item>

          <Item name="FORM_SUCCESS_BANNER" usage="Confirmation / info notice (password updated, reset). Orange, not green.">
            <div className={`${FORM_SUCCESS_BANNER} max-w-sm`}>Saved.</div>
          </Item>

          <Item name="<IncompleteFormNotice>" usage="Lists all unmet required fields at once (submit / validate / request)">
            <div className="w-full max-w-sm">
              <IncompleteFormNotice missing={["Coordinates", "Conflict", "Proof"]} />
            </div>
          </Item>

          <Item
            name="<FieldHelp>"
            usage="The one hover text in the app: a `?` on a label, a section heading, a filter bar or an icon group, whose bubble carries the concept's sentence from the lib/fieldHelp.ts registry (a native title attribute is never used). Registry-only: every instance of a concept reads the same words, so the `?` takes the concept key and nothing else."
          >
            <span className="inline-flex items-center gap-1 text-sm text-neutral-300">
              Coordinates <FieldHelp concept="coordinates" />
            </span>
          </Item>

          <Item name="<TagPicker>" usage="Conflict typeahead (ongoing by default, ended behind the switch) + curated/free tag selection (Pill chips + inline free-tag creation); submit / edit">
            <div className="w-full max-w-2xl">
              <TagPicker
                tags={tpTags}
                setTags={setTpTags}
                curatedTags={MOCK_CURATED}
                selectedTagIds={tpSelected}
                setSelectedTagIds={setTpSelected}
                conflicts={MOCK_CONFLICTS}
                selectedConflictIds={tpConflictSel}
                setSelectedConflictIds={setTpConflictSel}
              />
            </div>
          </Item>
        </section>

        {/* ============ CONTENT ============ */}
        {/* Small display pieces that fill rows, cards, and headers. */}
        <section className="space-y-3">
          <SectionEyebrow title="Content" />

          <Item name="<Avatar>" usage="The profile-picture circle: profile header (icon), feed card author circle via EntityCard + user search results (initial), sidebar identity row (icon, in the rail's 18px glyph box). `size` is the only dimension a caller sets: the icon fallback scales with the circle. A picture that fails to load falls back to the same circle (an avatar_url names a server-minted object on the media host, which a replace or remove deletes and a CDN edge can answer for before a new one propagates), and a new picture retries. iconClassName colours the icon fallback (the sidebar passes text-current so it tracks hover + the active accent); decorative drops the alt text where the host already names itself. Renders a <div>; as=&quot;span&quot; for phrasing-content hosts (the AuthorByline's avatar variant, the sidebar row's badge anchor).">
            <Variant label='fallback="icon" (profile header)'>
              <Avatar username="demo" size="w-11 h-11" fallback="icon" />
            </Variant>
            <Variant label='fallback="icon" (larger circle)'>
              <Avatar username="demo" size="w-16 h-16" fallback="icon" />
            </Variant>
            <Variant label='fallback="initial"'>
              <Avatar username="Marius" size="size-10" />
            </Variant>
            <Variant label="src that fails to load (falls back)">
              <Avatar
                username="Marius"
                size="size-10"
                src="/palette/this-avatar-does-not-exist.jpg"
              />
            </Variant>
            <Variant label='iconClassName (row colour, as the rail passes it)'>
              <span className="text-orange-400">
                <Avatar
                  as="span"
                  username="demo"
                  size="size-[18px]"
                  fallback="icon"
                  iconClassName="text-current"
                  decorative
                />
              </span>
            </Variant>
          </Item>

          <Item name="<AuthorByline>" usage="The 'by @user' assembly: detail-page subtitles, map panel header, detail body Author row. size=xs for the dense panel; prefix=false when the slot's label already says Author; avatar leads with the profile picture on the detail-page signature slots.">
            <Variant label="avatar (detail-page signature)">
              <span className="text-sm text-neutral-400">
                <AuthorByline author={MOCK_DETAIL.owner} avatar />
              </span>
            </Variant>
            <Variant label="default (subtitle)">
              <span className="text-sm text-neutral-400">
                <AuthorByline author={MOCK_DETAIL.owner} />
              </span>
            </Variant>
            <Variant label='size="xs" (panel header)'>
              <span className="text-xs text-neutral-400">
                <AuthorByline author={MOCK_DETAIL.owner} size="xs" />
              </span>
            </Variant>
          </Item>

          <Item name="<SourceLabel>" usage="Source display: the stored URL shortened to its host, with italic fallbacks for a null URL (To confirm) and a value the parser gives no host for (no source)">
            <SourceLabel url="https://t.me/some_channel/4242" variant="inline" />
            <SourceLabel url={null} variant="inline" />
          </Item>

          <Item
            name="<ArchivedCopies>"
            usage="The archived copy beside an outbound source link, on the event detail surfaces: the primary Source row, the Detected from row, and every expanded secondary mirror. One copy per link, from whichever service produced it, so the affordance is a single lucide mark: the Archive box, one mark for archiving in every state and for every provider, never the services' own logos. Provider identity lives in the accessible name of the stored copy, never in the shape. It is one ghost icon button in exactly two states, and colour says which: accent where a copy exists and the mark opens it, grey and disabled where none does, for every reader including the event's owner. Recording a copy is an edit, so it happens on the forms through <ArchiveAdornment> + <ArchiveSnapshotField> and files a version; nothing here writes. The mark carries no `?` of its own: the row's field concept explains it (source_url, secondary_source_urls, detected_from), so an expanded list of ten mirrors shows one explanation rather than ten. It sits `self-center` because those rows align their text on the baseline, where the square hangs low. Every mark looks alike across the page, so the accessible name carries the state and the target both: PRIMARY_SOURCE_DESCRIPTION for the source, DETECTED_FROM_DESCRIPTION for the provenance link, mirrorDescription(host, index, total) for a mirror, which leads with the position whenever the list holds more than one (two mirrors on one host would otherwise share a name) and falls back to a literal for a URL with no host."
          >
            <Variant label="a stored copy named for the Wayback Machine (primary source)">
              <span className="text-sm text-neutral-300">
                t.me
                <ArchivedCopies
                  copy={{
                    url: "https://web.archive.org/web/20260601120000/https://t.me/channel/12345",
                    provider: "wayback",
                  }}
                  describes={PRIMARY_SOURCE_DESCRIPTION}
                />
              </span>
            </Variant>
            <Variant label="a stored copy named for archive.today, same mark (mirror 2 of a multi-mirror list)">
              <span className="text-sm text-neutral-300">
                t.me
                <ArchivedCopies
                  copy={{ url: "https://archive.ph/abcde", provider: "archive_today" }}
                  describes={mirrorDescription("t.me", 1, 2)}
                />
              </span>
            </Variant>
            <Variant label="no copy yet: grey and inert, for every reader">
              <span className="text-sm text-neutral-300">
                x.com
                <ArchivedCopies copy={null} describes={DETECTED_FROM_DESCRIPTION} />
              </span>
            </Variant>
          </Item>

          <Item
            name="<ArchiveAdornment>"
            usage="The archive mark a link on a form carries, inside the URL field itself (<Input trailing>, or <LockedUrl trailing> where the value is frozen). One mark per link, where the link is typed, so archiving is not a block under the field. On a form it is never grey: whatever state the link is in there is something to do with it. No copy yet is the ArchiveRestore mark, which opens the paste line under the field; a link that already has one carries the Archive mark opening the stored copy (the same mark and name the event page shows) with ArchiveRestore beside it, since one link holds one copy and a wrong paste has to be replaceable. Every name folds in `describes`, because a form carries several of these and they look alike. Nothing is written here: the paste travels with the form."
          >
            <Variant label="no copy yet: the mark opens the paste line">
              <div className="w-full max-w-sm">
                <Input
                  type="url"
                  defaultValue="https://t.me/channel/12345"
                  trailing={
                    <ArchiveAdornment
                      describes={PRIMARY_SOURCE_DESCRIPTION}
                      copy={null}
                      expanded={false}
                      onToggle={() => {}}
                    />
                  }
                />
              </div>
            </Variant>
            <Variant label="a copy exists: it opens, and the second mark replaces it">
              <div className="w-full max-w-sm">
                <Input
                  type="url"
                  defaultValue="https://t.me/channel/12345"
                  trailing={
                    <ArchiveAdornment
                      describes={PRIMARY_SOURCE_DESCRIPTION}
                      copy={{ url: "https://archive.ph/abcde", provider: "archive_today" }}
                      expanded={false}
                      onToggle={() => {}}
                    />
                  }
                />
              </div>
            </Variant>
          </Item>

          <Item
            name="<ArchiveSnapshotField>"
            usage="The line the mark opens, directly under the URL field it archives: one field and nothing else. No label, no optional marker, no sentence, because the placeholder states the whole contract and reads the accepted hosts off SNAPSHOT_HOSTS. The trailing mark opens web.archive.org/save/<link> for the value currently typed above, so archiving a corrected URL is a re-click; it is the one place on a form a mark goes grey, since a link that does not parse has no page to open. isSnapshotUrl / SNAPSHOT_HINT are the client-side check (https + the three archive hosts) and the one sentence explaining it, reused by the forms to refuse a publish before the upload. Nothing is written here: the paste travels with the form as `source_snapshot_url` or as this row's `secondary_snapshot_urls` entry."
          >
            <div className="w-full max-w-sm space-y-2">
              <Variant label="a link is typed: the door is live">
                <ArchiveSnapshotField
                  link="https://t.me/channel/12345"
                  describes={PRIMARY_SOURCE_DESCRIPTION}
                  value=""
                  onChange={() => {}}
                />
              </Variant>
              <Variant label="no usable link yet: the door is inert">
                <ArchiveSnapshotField
                  link=""
                  describes={PRIMARY_SOURCE_DESCRIPTION}
                  value=""
                  onChange={() => {}}
                />
              </Variant>
              <Variant label="a paste that cannot be a snapshot">
                <ArchiveSnapshotField
                  link="https://t.me/channel/12345"
                  describes={PRIMARY_SOURCE_DESCRIPTION}
                  value="https://example.com/not-an-archive"
                  onChange={() => {}}
                />
              </Variant>
              <Variant label="one mirror's line">
                <ArchiveSnapshotField
                  link="https://rumble.com/v-mirror"
                  describes={mirrorDescription("rumble.com", 1, 2)}
                  value=""
                  onChange={() => {}}
                />
              </Variant>
            </div>
          </Item>

          <Item name="<Dot>" usage="The orange notification dot: the rail's identity row, the profile's detections entry, the map filter panel's in-flight pulse. Position / ring / size via className.">
            <Variant label="bare">
              <Dot />
            </Variant>
            <Variant label="on an icon corner">
              <span className="relative inline-flex size-7 items-center justify-center rounded-md bg-neutral-800 border border-neutral-700">
                <MapPin size={14} className="text-neutral-400" />
                <Dot className="absolute -top-0.5 -right-1 ring-2 ring-neutral-900" />
              </span>
            </Variant>
          </Item>

          <Item name="BrandGlyphs (XGlyph / GitHubGlyph / DiscordGlyph)" usage="The three third-party marks lucide doesn't ship, as inline SVG paths painting currentColor. `size` in px, so they sit with lucide icons at the same stop: the sidebar's community links, the submit form's 'From an X post' segment, the event share row, the profile's linked-account buttons.">
            <span className="inline-flex items-center gap-3 text-neutral-400">
              <XGlyph />
              <GitHubGlyph />
              <DiscordGlyph />
            </span>
          </Item>

          <Item name="<MediaGallery>" usage="The detail-surface media block: geoloc detail + map panel + request detail. variant=page (2-up hero grid) / panel (stacked thumbnails); one marked empty box, shown here through the shared TileNotice. A video tile is <VideoPlayer>, whose own bar already covers play, download and the expand control, so a clip carries no floating tile control at all. An image tile is cropped, so the tile itself opens <MediaLightbox> at hero resolution, and its download floats in the corner under HOVER_REVEAL. The card-sized media slot is private to <EntityCard> (its no-media box shows in the detection demo below).">
            <div className="w-full max-w-sm">
              <MediaGallery media={[]} alt="demo" />
            </div>
          </Item>

          <Item
            name="<GraphicContentGate>"
            usage="The age gate over media an author flagged as graphic (events.is_graphic). Wraps the media it covers: the children render blurred, inert and aria-hidden behind an interstitial that names what is underneath and asks the reader to confirm they are 18 or older. One confirmation reveals every gated instance for the rest of the browser session (a sessionStorage key plus the primitive's own subscriber set, since sessionStorage fires no storage event in the tab that wrote it). variant=full on the detail surfaces (MediaGallery on the event page and the map side panel, a proof body's inline images), variant=compact on the fixed-ratio card slots (MediaThumb on every catalogue card and the map pin preview), where the whole tile becomes the one labelled control. Painted from WARNING_CALLOUT, the heads-up register, and the confirm is a <Button>. Confirming in this demo reveals it everywhere else on the page too, which is the behaviour, not a demo artefact: reload to see the covered state again."
          >
            <Variant label="full (detail surfaces)">
              <div className="w-full max-w-sm">
                <GraphicContentGate>
                  <div className="h-40 rounded-lg border border-neutral-700 bg-neutral-800" />
                </GraphicContentGate>
              </div>
            </Variant>
            <Variant label="compact (card media slot)">
              <div className="relative w-28 aspect-video overflow-hidden rounded-md bg-neutral-800">
                <GraphicContentGate variant="compact">
                  <div className="h-full w-full bg-neutral-700" />
                </GraphicContentGate>
              </div>
            </Variant>
          </Item>

          <Item name="<VideoPlayer>" usage="The one video player: media-chrome's web components around a native <video>, mounted by MediaGallery's video tiles and by MediaLightboxBody, so playback chrome is identical on every surface and in every browser (the controls are custom elements, so they owe nothing to the React version). The bar holds exactly play, scrub, time, mute, volume, download and one big-view control, and nothing else (no casting, PiP, speed or captions); it fades out after two undisturbed seconds of playback and returns on pointer move, hover or focus. Big view is per context: a tile gets an expand control opening the shared lightbox, the lightbox itself gets real fullscreen. The download is MediaDownloadButton, since a plain <a download> is ignored cross-origin. Fills its container and letterboxes, so a portrait clip keeps its shape, and posters its first frame through the #t=0.1 media fragment. The skin is CSS variables set on the controller (neutral-100 glyphs, transparent controls on a translucent dark bar), so nothing reaches inside a shadow root and nothing fights Tailwind. A source the browser refuses swaps to TileNotice, keeping a download beside it so an undecodable original stays saveable, and that notice is what this demo shows unless NEXT_PUBLIC_DEMO_VIDEO_URL points at a real .mp4 (no sample ships with the repo).">
            <div className="h-48 w-full max-w-sm overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900">
              <VideoPlayer
                src={PALETTE_VIDEO_SRC}
                source={{ src: PALETTE_VIDEO_SRC, filename: "demo.mp4" }}
                title="Palette demo clip"
              />
            </div>
          </Item>

          <Item name="<MediaLightbox>" usage="The one media viewer, mounted by MediaGallery, MediaManager (through FileManager's shared MediaOverlay shell) and a proof body's images, so the viewer can't drift into per-surface copies. Backdrop click or Escape closes; the content click is stopped so the player's controls stay usable. Takes either a persisted Media (images view at hero) or a plain {src, kind} for a staged object URL or a proof image. The corner MediaDownloadButton is for images: a clip plays in <VideoPlayer>, whose control bar already carries one. MediaLightboxBody alone renders the sized media for a caller that already owns a shell.">
            <PaletteMediaLightbox />
          </Item>

          <Item name="<MediaDownloadButton>" usage="The one blob-download control: on a MediaGallery image tile, in the lightbox corner, beside a proof image, and inside VideoPlayer's control bar. Fetches the object cross-origin and saves it under original_filename, or a plain URL under its basename (the media origin ignores a plain <a download>, which is also why the player's built-in download is replaced by this one). Composes <Button icon variant=ghost> over FLOATING_CONTROL, the translucent plate that keeps a glyph readable on top of arbitrary pixels, in the same neutral register as the player's own controls so floating controls and the player read as one family (shared with the lightbox's close). Inside the player's bar it drops the plate and takes the 44px flat box of a media-chrome control instead.">
            <span className="relative inline-flex size-16 items-center justify-center rounded-md bg-neutral-800 border border-neutral-700">
              <MediaDownloadButton source={PALETTE_MEDIA} />
            </span>
          </Item>

          <Item name="HOVER_REVEAL" usage="Opacity-only paint for a floating media control cluster: invisible at rest, revealed by a pointer over the frame (the frame carries `group`) or by keyboard focus inside it, and pinned visible on a coarse pointer, since a touch device can never trigger a hover. Used by MediaGallery's image tiles and by ProofImage; a video needs none, its player reveals its own bar. Hover the frame below.">
            <div className="group relative h-24 w-40 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800">
              <div
                className={`absolute right-2 top-2 flex items-center gap-1 ${HOVER_REVEAL}`}
              >
                <MediaDownloadButton source={PALETTE_MEDIA} />
              </div>
            </div>
          </Item>

          <Item name="<StatTile> / <StatGrid>" usage="KPI tiles: the profile's Insights row, admin metric grids">
            <div className="w-full max-w-xl">
              <StatGrid>
                <StatTile icon={MapPin} label="Geolocated" value={42} />
                <StatTile icon={Bot} label="Detected" value={128} />
                <StatTile icon={Archive} label="Closed" value={37} />
                <StatTile icon={Film} label="Media" value={96} />
              </StatGrid>
            </div>
          </Item>

          <Item name="<SourceHostBar>" usage="Where a body of work's footage came from (profile insights): one stacked bar over the ranked hosts, widest slice on the strongest accent step, with the unnamed tail and the source-less events in their own neutral slices so the bar accounts for every event counted. The legend is the readable half; the bar is aria-hidden, since a phone has no hover to reveal a title with. Bare hosts, the vocabulary <SourceLabel> already shows a source under.">
            <div className="w-full max-w-xs space-y-4">
              <SourceHostBar
                hosts={[
                  { name: "x.com", count: 33 },
                  { name: "t.me", count: 14 },
                  { name: "tiktok.com", count: 1 },
                ]}
                otherCount={0}
                noSourceCount={0}
              />
              <SourceHostBar
                hosts={[
                  { name: "x.com", count: 12 },
                  { name: "t.me", count: 9 },
                  { name: "youtube.com", count: 5 },
                  { name: "vk.com", count: 4 },
                  { name: "tiktok.com", count: 2 },
                ]}
                otherCount={6}
                noSourceCount={3}
              />
              <SourceHostBar hosts={[]} otherCount={0} noSourceCount={0} />
            </div>
          </Item>

          <Item name="<ActivityHeatmap>" usage="Contribution grid at month resolution (profile insights): one row per calendar year, twelve month cells, intensity off the busiest month. Months rather than days, because an analyst publishes tens of events a year and a daily grid would be blank almost everywhere. Hover or tap a lit month and the line under the grid names it and its count; the cells are paint, not controls, so the grid takes no focus stop. Empty months keep the absence paint, so the ramp marks exactly what carries a count. No dated event renders a sentence; a single month keeps the grid, since the empty cells beside the lit one are what say which month it was.">
            <div className="w-full max-w-sm space-y-4">
              <ActivityHeatmap
                buckets={[
                  ...Array.from({ length: 10 }, (_, i) => ({
                    period: `2025-${String(i + 3).padStart(2, "0")}`,
                    count: [4, 0, 7, 2, 0, 0, 11, 5, 1, 3][i],
                  })),
                  ...Array.from({ length: 6 }, (_, i) => ({
                    period: `2026-${String(i + 1).padStart(2, "0")}`,
                    count: [0, 2, 9, 6, 0, 1][i],
                  })),
                ]}
              />
              <ActivityHeatmap buckets={[{ period: "2024-05", count: 12 }]} />
              <ActivityHeatmap buckets={[]} />
            </div>
          </Item>

          <Item name="<NumberedSteps>" usage="Static &quot;1, 2, 3…&quot; instruction list: numbered disc + title + body. `plain` on the public guides (/guide, /methodology, /import), `boxed` with a per-step icon for the archive export walkthrough on /submit. Not <ProgressSteps>: this is reference copy the reader works through, every step identical; ProgressSteps renders one running operation's live state (done / active / pending / failed).">
            <div className="w-full max-w-md space-y-4">
              <Variant label="plain (the guides)">
                <NumberedSteps
                  steps={[
                    {
                      title: "Pin the visual anchors",
                      body: "Three or more durable features: signage, road geometry, building footprints.",
                    },
                    {
                      title: "Cross-reference on satellite imagery",
                      body: "Confirm shape, scale, and relative position.",
                    },
                  ]}
                />
              </Variant>
              <Variant label="boxed + per-step icon (the archive walkthrough)">
                <NumberedSteps
                  variant="boxed"
                  steps={[
                    {
                      icon: Download,
                      title: "Download the .zip",
                      body: "Save the archive X built for you.",
                    },
                    {
                      icon: Upload,
                      title: "Upload it here",
                      body: "We map the geolocations in your posts for you to review.",
                    },
                  ]}
                />
              </Variant>
            </div>
          </Item>

          <Item name="<MockPost>" usage="A fake X post in X's own dark card, so a guide can show the shape of a real post instead of describing it (/import teaches what to write and what the bot answers). Illustration only: the &quot;links&quot; are <MockPostLink> spans, never anchors, and the body breaks anywhere so a long one cannot widen its column. MOCK_ANALYST and MOCK_BOT are the shared identities, so the guides read as one person's posts. `media` attaches one placeholder, `quoted` renders the quote card X draws around a quoted post (with its own optional media), `replyingTo` puts a handle in the byline.">
            <div className="w-full max-w-sm space-y-3">
              <Variant label="a post with an attachment">
                <MockPost
                  {...MOCK_ANALYST}
                  media={{ kind: "image", label: "an attached photo" }}
                >
                  {"Strike on the vehicle depot\n48.123456, 37.654321\n"}
                  <MockPostLink>x.com/warfootage/status/1783</MockPostLink>
                </MockPost>
              </Variant>
              <Variant label="a post quoting the footage it geolocates">
                <MockPost
                  {...MOCK_ANALYST}
                  quoted={{
                    handle: "@warfootage",
                    text: "Footage near 49.842900, 24.031100 by the bridge",
                    media: { kind: "video", label: "the quoted video" },
                  }}
                >
                  {"Geolocated this one."}
                </MockPost>
              </Variant>
              <Variant label="the bot answering in-thread">
                <MockPost {...MOCK_BOT} replyingTo={MOCK_ANALYST.handle}>
                  {"✅ 1 detection saved · ref 94183d44"}
                </MockPost>
              </Variant>
            </div>
          </Item>

          <Item name="<ProgressSteps>" usage="Vertical stepper for a live multi-step operation (the archive import): check for done, highlighted disc for the active step with a determinate bar only when a real `progress` ratio exists (a discreet `spinner` otherwise), muted for pending. `keepDetail` pins a step's detail after completion (a privacy guarantee, a final count); `failed` turns the active step into the red failure marker.">
            <div className="w-full max-w-sm">
              <Variant label="determinate bar + persistent detail on a completed step">
                <ProgressSteps
                  steps={[
                    {
                      label: "Filtering out private data",
                      detail: "DMs, messages and account data never leave your device.",
                      keepDetail: true,
                    },
                    { label: "Uploading your archive", progress: 0.62, detail: "381 MB of 612 MB" },
                    { label: "Queued for import" },
                    { label: "Extracting geolocations" },
                    { label: "Done" },
                  ]}
                  active={1}
                />
              </Variant>
            </div>
            <div className="w-full max-w-sm">
              <Variant label="spinner (no measurable ratio)">
                <ProgressSteps
                  steps={[
                    { label: "Filtering out private data" },
                    { label: "Uploading your archive" },
                    {
                      label: "Queued for import",
                      spinner: true,
                      detail: "~3,790 posts in your archive.",
                    },
                    { label: "Extracting geolocations" },
                    { label: "Done" },
                  ]}
                  active={2}
                />
              </Variant>
            </div>
            <div className="w-full max-w-sm">
              <Variant label="failed step">
                <ProgressSteps
                  steps={[
                    { label: "Filtering out private data" },
                    { label: "Uploading your archive" },
                    { label: "Queued for import" },
                    { label: "Extracting geolocations", detail: "The import failed on our side." },
                    { label: "Done" },
                  ]}
                  active={3}
                  failed
                />
              </Variant>
            </div>
          </Item>

          <Item name="<LinkRow>" usage="Stay in touch and Guides (About). The profile's linked accounts are icon buttons instead, so this row is the About page's alone. The trailing ↗ marks external only: an in-app href routes through next/link, a mailto stays a plain <a>, and neither takes the glyph.">
            <div className="w-full max-w-md space-y-2">
              <LinkRow icon={AtSign} label="X / Twitter" value="@vidithq" href="https://x.com/vidithq" />
              <LinkRow icon={BookOpen} label="How Vidit works" value="/guide" href="/guide" external={false} />
              <LinkRow icon={Mail} label="Email" value="hello@vidit.app" href="mailto:hello@vidit.app" external={false} />
              <LinkRow icon={MessageCircle} label="Discord" value="a-handle (unresolved)" />
            </div>
          </Item>

          <Item name="<SectionHeading>" usage="Form section heading (Details, Location, Tags...)">
            <SectionHeading title="Source media" concept="source_media" />
            <SectionHeading title="Proof" concept="section_proof" />
          </Item>

          <Item name="<SectionEyebrow>" usage="Detail page + card/panel headings (uppercase eyebrow)">
            <Variant label="as=h2 (page)">
              <SectionEyebrow title="Details" concept="section_details" />
            </Variant>
            <Variant label="no concept">
              <SectionEyebrow title="Geolocators" />
            </Variant>
          </Item>
        </section>

        {/* ============ CONTAINERS & states ============ */}
        {/* Boxes you drop content into, and the pre-data / empty states. */}
        <section className="space-y-3">
          <SectionEyebrow title="Containers & states" />

          <Item name="<Card>" usage="Panels: settings, admin, profile, form sections. One rhythm (space-y-4) for all.">
            <Card className="w-48">
              <p className="text-xs text-neutral-300">Content</p>
              <p className="text-xs text-neutral-500">Second line</p>
            </Card>
          </Item>

          <Item name="<DetailCard> + <DetailRow>" usage="Geoloc & request detail pages (label / value)">
            <div className="w-full max-w-md">
              <DetailCard>
                <DetailRow label="Status" concept="status">
                  <StatusBadge status="geolocated" />
                </DetailRow>
                <DetailRow label="Source" concept="source_url" value="t.me/channel/123" />
                <DetailRow label="Coordinates" concept="coordinates" value="48.0159, 37.8024" />
              </DetailCard>
            </div>
          </Item>

          <Item name="<ProofSection>" usage="Proof section on geoloc + request detail: eyebrow + bordered box">
            <div className="w-full max-w-xl">
              <ProofSection>
                <div className="text-sm text-neutral-300 leading-relaxed">
                  The proof body goes here (a rendered doc, or request notes).
                </div>
              </ProofSection>
            </div>
          </Item>

          <Item name="<EmptyState>" usage="The one empty-state grammar. boxed: empty list pages (requests, search). plain: headline + hint + CTA inside an existing container (detections, recent submissions). invite: dashed first-run hero (timeline). One variant per site.">
            <div className="w-full max-w-md space-y-3">
              <Variant label='variant="boxed" (default)'>
                <EmptyState>
                  Nothing here yet.{" "}
                  <a href="#" className={TEXT_LINK} onClick={(e) => e.preventDefault()}>
                    Create the first one
                  </a>
                  .
                </EmptyState>
              </Variant>
              <Variant label='variant="plain"'>
                <EmptyState
                  variant="plain"
                  lead="Nothing to review."
                  cta={
                    <a href="#" className={`text-xs ${TEXT_LINK}`} onClick={(e) => e.preventDefault()}>
                      Back to profile
                    </a>
                  }
                >
                  New items land here once something happens.
                </EmptyState>
              </Variant>
              <Variant label='variant="invite" (+ icon)'>
                <EmptyState
                  variant="invite"
                  icon={MapPin}
                  lead="Your timeline is empty"
                  cta={<Button variant="primary">Explore the map</Button>}
                >
                  Follow other analysts to see their latest geolocations here.
                </EmptyState>
              </Variant>
            </div>
          </Item>

          <Item name="<CuratedTagsError>" usage="Submit & edit forms (curated tags failed to load)">
            <div className="w-full max-w-xl">
              <CuratedTagsError onRetry={() => {}} />
            </div>
          </Item>

          <Item name="<PageLoading> / <PageError>" usage="Full-screen states before data (detail pages, lists)">
            <p className="text-xs text-neutral-500">
              Full-screen centered states: a quiet{" "}
              <span className="text-neutral-400">Loading…</span>, or an error message
              with an optional Back to map link. Not rendered here (takes the full height).
            </p>
          </Item>
        </section>

        {/* ============ COMPOSED views ============ */}
        {/* Full assemblies of the pieces above; the closing list is what can't
            be mocked on a static page. */}
        <section className="space-y-3">
          <SectionEyebrow title="Composed views" />

          <Item name="<EntityCard variant=feed>" usage="Feed (timeline), for all 3 types">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="feed"
                detailHref="/events/demo"
                title={MOCK_CARD_GEO.title}
                badge={<StatusBadge status="detected" />}
                author={MOCK_CARD_GEO.owner}
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
                detailHref="/events/demo"
                title={MOCK_CARD_GEO.title}
                badge={<StatusBadge status="geolocated" />}
                author={MOCK_CARD_GEO.owner}
                date={MOCK_CARD_GEO.event_date}
                coords={{ lat: 48.0159, lng: 37.8024 }}
                tags={MOCK_CARD_GEO.tags}
              />
            </div>
          </Item>

          <Item name="<EntityCard variant=compact>: request" usage="/requests + search results">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="compact"
                detailHref="/requests/demo"
                title="Footage wanted near Bakhmut"
                badge={<StatusBadge status="requested" />}
                author={{ username: "analyst" }}
                date="2026-05-01"
                source={{ url: "https://t.me/channel/4242" }}
                tags={MOCK_TAGS}
              />
            </div>
          </Item>

          <Item name="<EntityCard variant=compact>: no media" usage="A card whose entity carries no media: the marked no-media placeholder, not a generated stand-in">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="compact"
                detailHref="/events/demo"
                title={MOCK_DETAIL.title}
                badge={<StatusBadge status="detected" />}
                author={{ username: MOCK_DETAIL.owner.username }}
                date={MOCK_DETAIL.event_date ?? undefined}
                coords={MOCK_DETAIL.event_coords}
                tags={MOCK_DETAIL.tags}
              />
            </div>
          </Item>

          <Item name="<DetectionQueueRow>" usage="Detections queue: denser than a card (no byline, coords or tags), whole row clicks through to the edit form. One badge, describing the evidence: 'Ready to review' (outline tone, waiting on a review's judgment, never a complete state), one named missing piece, or a count of several. Hover any badge: every state carries title text saying what it means, which pieces are missing in full, and what to do next.">
            <div className="w-full max-w-xl space-y-2">
              <DetectionQueueRow detection={MOCK_DETECTION_READY} />
              <DetectionQueueRow detection={MOCK_DETECTION_ONE_MISSING} />
              <DetectionQueueRow detection={MOCK_DETECTION_SEVERAL_MISSING} />
            </div>
          </Item>

          <Item name="<EventDetailBody>" usage="Geoloc detail page + map panel (page/panel variant)">
            <div className="w-full max-w-2xl space-y-4">
              <Variant label="source with no archival record yet (the icon pair renders nothing)">
                <EventDetailBody geo={MOCK_DETAIL} variant="page" />
              </Variant>
              <Variant label="source + archived copies (expand Secondary sources for the one-provider and failed mirrors)">
                <EventDetailBody geo={MOCK_DETAIL_ARCHIVED} variant="page" />
              </Variant>
            </div>
          </Item>

          <Item name="Not rendered (runtime state required)" usage="Genuinely impractical to mock here">
            <ul className="text-[11px] text-neutral-500 space-y-1 list-disc pl-4">
              <li><span className="font-mono text-neutral-400">FileManager / MediaManager</span>: upload, needs real pending files</li>
              <li><span className="font-mono text-neutral-400">BetaBanner</span>: a {"<Pill tone=\"accent\">"} in a <code>position: fixed</code> wrapper, already visible bottom-right</li>
              <li><span className="font-mono text-neutral-400">Sidebar</span>: fixed nav rail, auth/route-driven, always on screen</li>
              <li><span className="font-mono text-neutral-400">PageShell / PageFrame</span>: page scaffolding, this very page</li>
            </ul>
          </Item>
        </section>
      </div>
    </PageShell>
  );
}

// ── Filter-family demos (stateful, so they live as tiny components) ─────────

// One mock persisted row, shared by the download and lightbox demos so the two
// show the same media. The URL is the app's own OG image: extensionless, so
// `displayUrlsFor` finds no sibling to derive and every size resolves to it (a
// real backend row has `_hero` / `_thumb` siblings, which this demo has not).
const PALETTE_MEDIA: Media = {
  id: "palette-demo",
  role: "source",
  storage_url: "/opengraph-image",
  media_type: "image",
  sha256: null,
  original_filename: "demo.png",
};

// No sample clip ships with the repo, so the player demo plays whatever the
// landing's demo video is pointed at when that is configured, and otherwise
// falls to a source the browser cannot fetch, which is what puts the graceful
// failure notice on screen. Point the variable at an `.mp4`: the demo names its
// download `demo.mp4`, so another container would save under a wrong extension
// here (only here, since a real Media row is named by `original_filename`).
const PALETTE_VIDEO_SRC =
  process.env.NEXT_PUBLIC_DEMO_VIDEO_URL ?? "/palette-demo-placeholder.mp4";

function PaletteMediaLightbox() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open the viewer
      </Button>
      {open && (
        <MediaLightbox
          source={PALETTE_MEDIA}
          alt="Palette demo media"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PaletteActiveFilterPills() {
  const [active, setActive] = useState(["Russo-Ukrainian War", "dashcam", "by @ana-demo"]);
  if (active.length === 0)
    return (
      <button className="text-[11px] text-neutral-500" onClick={() => setActive(["Russo-Ukrainian War", "dashcam", "by @ana-demo"])}>
        All removed. Reset the demo
      </button>
    );
  return (
    <ActiveFilterPills
      filters={active.map((label) => ({
        key: label,
        label,
        onRemove: () => setActive((prev) => prev.filter((l) => l !== label)),
      }))}
      onClearAll={() => setActive([])}
    />
  );
}

function PaletteFilterSection() {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<string[]>(["Drone"]);
  return (
    <div className="w-72 bg-neutral-900 rounded-lg border border-neutral-700 px-3">
      <FilterSection
        title="Capture source"
        summary={chipSummary(selected)}
        active={selected.length > 0}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      >
        <ChipBucket
          options={["Drone", "Dashcam", "CCTV"].map((n) => ({ id: n, name: n }))}
          selected={selected}
          onToggle={(n) =>
            setSelected((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]))
          }
        />
      </FilterSection>
    </div>
  );
}

function PaletteChipBucket() {
  const [selected, setSelected] = useState<string[]>(["Image"]);
  return (
    <ChipBucket
      options={["Image", "Video"].map((n) => ({ id: n, name: n }))}
      selected={selected}
      onToggle={(n) =>
        setSelected((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]))
      }
    />
  );
}

function PaletteToggleRow() {
  const [on, setOn] = useState(true);
  return (
    <div className="w-72 bg-neutral-900 rounded-lg border border-neutral-700 px-3">
      <ToggleRow label="Hide closed rows" on={on} onToggle={() => setOn((v) => !v)} />
    </div>
  );
}

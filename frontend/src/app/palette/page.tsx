"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import {
  AtSign,
  Calendar,
  Check,
  Circle,
  Mail,
  MapPin,
  MessageCircle,
  Search as SearchIcon,
  UserPlus,
  Users,
} from "lucide-react";

import type { Conflict, EventDetail, EventStatus, Tag } from "@/types";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TagPicker } from "@/components/ui/TagPicker";
import { EntityCard } from "@/components/ui/EntityCard";
import { EventDetailBody } from "@/components/event/EventDetailBody";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DetailCard, DetailRow } from "@/components/ui/DetailRow";
import { LinkRow } from "@/components/ui/LinkRow";
import { StatTile, StatGrid } from "@/components/ui/StatTile";
import { ActivityBars } from "@/components/ui/ActivityBars";
import { ProgressSteps } from "@/components/ui/ProgressSteps";
import { ActiveFilterPills } from "@/components/ui/ActiveFilterPills";
import { ChipBucket } from "@/components/ui/ChipBucket";
import { FilterSection, chipSummary } from "@/components/ui/FilterSection";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar } from "@/components/ui/Avatar";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Dot } from "@/components/ui/Dot";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { CuratedTagsError } from "@/components/geolocations/CuratedTagsError";
import { IncompleteFormNotice } from "@/components/ui/IncompleteFormNotice";
import { OptionalHint } from "@/components/ui/OptionalHint";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { SourceLabel } from "@/components/ui/SourceLabel";
import { StatusBadge } from "@/components/event/StatusBadge";
import {
  TEXT_LINK,
  TAPPABLE_HOVER,
  ACCENT_SURFACE,
  WARNING_CALLOUT,
} from "@/components/ui/styles";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
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
import { Input } from "@/components/ui/Input";

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

// A full geolocation, for the detail body + detection card. `is_demo` so the
// source renders as "synthetic" rather than a link that 404s.
const MOCK_DETAIL: EventDetail = {
  id: "demo",
  title: "Strike on a depot, Donetsk",
  event_coords: { lat: 48.0159, lng: 37.8024 },
  capture_source_coords: null,
  event_date: "2026-05-09",
  is_demo: true,
  status: "geolocated",
  close_reason: null,
  before_closed_status: null,
  owner: {
    id: "a1",
    username: "analyst",
    is_trusted: true,
    trust_reason: "Verified analyst",
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
  source_url: "synthetic://demo",
  event_time: "15:45:00",
  source_posted_at: "2026-05-09T15:45:00Z",
  detected_from_url: null,
  detected_post_at: null,
  proof: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  requested_at: null,
  detected_at: null,
  geolocated_at: "2026-06-01T00:00:00Z",
  closed_at: null,
  media: [],
  requested_by: null,
  geolocators: [],
  investigator_count: 0,
  investigators: [],
};

// The lighter geolocation-card payload (timeline / recent-submissions shape).
const MOCK_CARD_GEO = {
  id: "demo",
  title: "Strike on a depot near Donetsk",
  event_date: "2026-05-09",
  is_demo: true,
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

          <Item name="<Button>" usage="Two axes: tone (accent / danger) and emphasis (filled → outline → text). Everything clickable is the accent colour, red is destructive, no grey button. `icon` makes a square icon-only button; `DANGER_CONFIRM` is the one loud filled red, applied only to the armed two-click confirm.">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
                <Button icon variant="ghost" aria-label="Locate">
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

          <Item name="<ActiveFilterPills>" usage="The one rendering of active filters: a row of removable accent chips (label + ×), shared by the map's filter overlay and the search page so active filter state reads identically everywhere. Entries are {key, label, icon?, onRemove}; `onClearAll` adds a quiet clear-everything affordance once two or more filters are on. Renders nothing when the list is empty.">
            <PaletteActiveFilterPills />
          </Item>

          <Item name="<FilterSection>" usage="One collapsible filter section (chipSummary / rangeSummary build its collapsed one-line summary, orange when active). Open state is parent-owned (open + onToggle) so re-renders never reset the accordion; the optional `concept` wires the shared FieldHelp `?`. Shared by the map overlay and the search filter area.">
            <PaletteFilterSection />
          </Item>

          <Item name="<ChipBucket>" usage="A multi-select chip bucket for one filter family (conflicts, capture sources, tags, media types): every option a <Pill>, selected ones filled accent, click toggles membership. Any-match within the bucket; combining buckets is AND on the server.">
            <PaletteChipBucket />
          </Item>

          <Item name="<ToggleRow>" usage="A compact on/off row for a boolean filter (Trusted only, Hide demo): the whole row is the switch (role + click), the <Switch> rendering as its visual span. Shared by the map overlay and the search filter area.">
            <PaletteToggleRow />
          </Item>

          <Item name="<Pill>" usage="One pill for the whole family (status, tag, filter, badge) at one size. `tone` = accent | secondary | neutral | danger | strong, mirroring the <Button> tones (secondary is the accent outline, no fill). A static <span> by default; pass `onClick` and it becomes an interactive chip (a <button> that brightens on hover), the caller driving the tone off its active state. className merges via cn (caller wins on a conflicting utility); keep it to orthogonal extras, the size stays one.">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-neutral-600 self-center w-12">static</span>
                <Pill tone="accent" icon={<MapPin size={11} />}>
                  accent
                </Pill>
                <Pill tone="secondary">secondary</Pill>
                <Pill tone="neutral">neutral</Pill>
                <Pill tone="danger">danger</Pill>
                <Pill tone="strong">strong</Pill>
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

          <Item name="<SegmentedControl>" usage="Exclusive-choice bar: submit mode (single / bulk import), admin delete mode (soft / hard). tone=danger paints a destructive option's active state red; fullWidth stretches the track.">
            <div className="space-y-3">
              <SegmentedControl
                aria-label="Demo mode"
                options={[
                  { value: "single", label: "Single" },
                  { value: "bulk", label: "Bulk import" },
                ]}
                value={segSel}
                onChange={setSegSel}
              />
              <SegmentedControl
                aria-label="Demo delete mode"
                options={[
                  { value: "soft", label: "Soft delete" },
                  { value: "hard", label: "Hard delete", tone: "danger" },
                ]}
                value={segMode}
                onChange={setSegMode}
              />
            </div>
          </Item>

          <Item name="<Switch>" usage="The one boolean toggle: settings rows (md), map filter rows (sm). as='span' renders the visual only, for a parent that owns the click (whole-row toggles).">
            <Variant label='size="md"'>
              <Switch on={swOn} onToggle={() => setSwOn(!swOn)} aria-label="Demo switch" />
            </Variant>
            <Variant label='size="sm"'>
              <Switch size="sm" on={swOn} onToggle={() => setSwOn(!swOn)} aria-label="Demo switch small" />
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

          <Item name="<Input> (+ FORM_INVALID_FIELD)" usage="The one form field: variant (default / compact / locked) + invalid + icon. `<Input invalid>` is sugar over the FORM_INVALID_FIELD red-outline token; the same raw token flags non-input surfaces too (media dropzone, proof editor, section cards). `icon` overlays a leading icon (the search box). Native props + className pass through.">
            <div className="w-full max-w-sm space-y-2">
              <Variant label="default">
                <Input placeholder="Type here..." />
              </Variant>
              <Variant label="icon (search box)">
                <Input icon={<SearchIcon size={14} />} type="search" placeholder="Search…" />
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

          <Item name="<FieldHelp> + <OptionalHint>" usage="Help ? on labels/sections + optional marker">
            <span className="inline-flex items-center gap-1 text-sm text-neutral-300">
              Coordinates <FieldHelp concept="coordinates" /> <OptionalHint />
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

          <Item name="<Avatar>" usage="Profile header (icon) + user search results (initial)">
            <Variant label='fallback="icon"'>
              <Avatar username="demo" size="w-16 h-16" fallback="icon" />
            </Variant>
            <Variant label='fallback="initial"'>
              <Avatar username="Marius" size="size-10" />
            </Variant>
          </Item>

          <Item name="<AuthorByline>" usage="The 'by @user + TrustBadge' assembly: detail-page subtitles, map panel header, detail body Author row. size=xs for the dense panel; prefix=false when the slot's label already says Author.">
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

          <Item name="<SourceLabel>" usage="Source display (shortened host, or synthetic in demo)">
            <SourceLabel isDemo={false} url="https://t.me/some_channel/4242" variant="inline" />
            <SourceLabel isDemo url="synthetic://demo" variant="inline" />
          </Item>

          <Item name="<Dot>" usage="The orange notification dot: sidebar nav badges, landing + beta pills, detections entry. Position / ring / size via className.">
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

          <Item name="<MediaGallery>" usage="The detail-surface media block: geoloc detail + map panel + request detail. variant=page (2-up hero grid) / panel (stacked thumbnails); videos poster their first frame (#t=0.1 + preload=metadata); one marked empty box (shown here). The card-sized media slot is private to <EntityCard> (its no-media box shows in the detection demo below).">
            <div className="w-full max-w-sm">
              <MediaGallery media={[]} alt="demo" />
            </div>
          </Item>

          <Item name="<StatTile> / <StatGrid>" usage="KPI tiles: profile stats, future metric grids">
            <div className="w-full max-w-xl">
              <StatGrid>
                <StatTile icon={MapPin} label="Submitted" value={42} />
                <StatTile icon={Users} label="Followers" value={128} />
                <StatTile icon={UserPlus} label="Following" value={37} />
                <StatTile icon={Calendar} label="Since" value="27 Jun 2026" small />
              </StatGrid>
            </div>
          </Item>

          <Item name="<ActivityBars>" usage="Fixed-width monthly activity row (profile insights): one bar per bucket, heights relative to the max, accent for active months, neutral stub for empty ones. Hover a bar for month + count.">
            <div className="w-full max-w-xs">
              <ActivityBars
                buckets={[
                  { month: "2025-08", count: 0 },
                  { month: "2025-09", count: 2 },
                  { month: "2025-10", count: 5 },
                  { month: "2025-11", count: 1 },
                  { month: "2025-12", count: 0 },
                  { month: "2026-01", count: 3 },
                  { month: "2026-02", count: 8 },
                  { month: "2026-03", count: 4 },
                  { month: "2026-04", count: 0 },
                  { month: "2026-05", count: 6 },
                  { month: "2026-06", count: 2 },
                  { month: "2026-07", count: 7 },
                ]}
              />
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

          <Item name="<LinkRow>" usage="Linked accounts (profile) + Stay in touch (About)">
            <div className="w-full max-w-md space-y-2">
              <LinkRow icon={AtSign} label="X / Twitter" value="@vidithq" href="https://x.com/vidithq" />
              <LinkRow icon={Mail} label="Email" value="hello@vidit.app" href="mailto:hello@vidit.app" external={false} />
              <LinkRow icon={MessageCircle} label="Discord" value="a-handle (unresolved)" />
            </div>
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
                detailHref="/events/demo/edit"
                title={MOCK_DETAIL.title}
                badge={<StatusBadge status="detected" />}
                author={{ username: MOCK_DETAIL.owner.username }}
                date={MOCK_DETAIL.event_date ?? undefined}
                coords={MOCK_DETAIL.event_coords}
                tags={MOCK_DETAIL.tags}
              />
            </div>
          </Item>

          <Item name="<EventDetailBody>" usage="Geoloc detail page + map panel (page/panel variant)">
            <div className="w-full max-w-2xl space-y-4">
              <EventDetailBody geo={MOCK_DETAIL} variant="page" />
            </div>
          </Item>

          <Item name="Not rendered (runtime state required)" usage="Genuinely impractical to mock here">
            <ul className="text-[11px] text-neutral-500 space-y-1 list-disc pl-4">
              <li><span className="font-mono text-neutral-400">FileManager / MediaManager</span>: upload, needs real pending files</li>
              <li><span className="font-mono text-neutral-400">ClosedBetaBanner</span>: a {"<Pill tone=\"accent\">"} in a <code>position: fixed</code> wrapper, already visible bottom-right</li>
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
      <ToggleRow label="Trusted analysts only" on={on} onToggle={() => setOn((v) => !v)} />
    </div>
  );
}

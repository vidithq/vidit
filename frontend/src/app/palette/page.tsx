"use client";

import { useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Archive,
  AtSign,
  ClipboardCheck,
  UserPlus,
  BookOpen,
  Bot,
  Camera,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  History,
  Mail,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Search as SearchIcon,
  SquarePen,
  Swords,
  Upload,
  X,
} from "lucide-react";

import type { Conflict, EventDetail, EventStatus, Media, Tag } from "@/types";
import { PageShell } from "@/components/ui/PageShell";
import { AccountPicker, analystAccount, type Account } from "@/components/ui/AccountPicker";
import { Popover } from "@/components/ui/Popover";
import { MapControlButton } from "@/components/ui/MapControlButton";
import {
  PUBLISHING_LABEL,
  PUBLISH_CONFIRM,
  PublishActions,
  REQUEST_CONFIRM,
  SAVING_LABEL,
  publishGeolocationButton,
  requestWriteButton,
  usePublishAction,
} from "@/components/geolocations/PublishActions";
import { Combobox } from "@/components/ui/Combobox";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { CopyButton } from "@/components/ui/CopyButton";
import { CountBadge } from "@/components/ui/CountBadge";
import { Tooltip } from "@/components/ui/Tooltip";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { PageWithRail } from "@/components/ui/PageWithRail";
import { Card } from "@/components/ui/Card";
import { CharCounter } from "@/components/ui/CharCounter";
import { Pill } from "@/components/ui/Pill";
import { cardTags } from "@/lib/cardTags";
import {
  DiscordGlyph,
  GitHubGlyph,
  XGlyph,
} from "@/components/ui/BrandGlyphs";
import { ConflictChips, TagChips, TagPicker } from "@/components/ui/TagPicker";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { RemoveButton } from "@/components/ui/RemoveButton";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { EntityCard } from "@/components/ui/EntityCard";
import { CollectionCover } from "@/components/collections/CollectionCover";
import { DetectionQueueRow } from "@/components/detections/DetectionQueueRow";
import { eventPageSlots, eventPanelContent } from "@/components/event/EventDetailBody";
import { MapPanelBody } from "@/components/map/MapSidePanel";
import { EventLayout } from "@/components/event/EventLayout";
import { EventShellPreview } from "./eventShellDemo";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DetailCard, DetailPills, DetailRow } from "@/components/ui/DetailRow";
import { LegalLinks } from "@/components/ui/LegalLinks";
import { LinkRow } from "@/components/ui/LinkRow";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { StatTile, StatGrid } from "@/components/ui/StatTile";
import { HorizontalScroller } from "@/components/ui/HorizontalScroller";
import { IconTile } from "@/components/ui/IconTile";
import { SUBMIT_PATHS } from "@/components/geolocations/SubmitChooser";
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
import { ActionRow } from "@/components/ui/ActionRow";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { ChoiceRow } from "@/components/ui/ChoiceRow";
import { SwatchPicker } from "@/components/ui/SwatchPicker";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadMoreRow, ShowMoreLink } from "@/components/ui/LoadMoreRow";
import { Avatar } from "@/components/ui/Avatar";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { organizationByline } from "@/lib/organizations";
import { Dot } from "@/components/ui/Dot";
import { GraphicContentGate } from "@/components/ui/GraphicContentGate";
import { WithheldBanner } from "@/components/ui/WithheldBanner";
import { MediaGallery } from "@/components/ui/MediaGallery";
import { MediaDownloadButton } from "@/components/ui/MediaDownloadButton";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SourceBlock, SourceBlocks } from "@/components/sources/SourceBlock";
import { SourceImageryCheck } from "@/components/sources/SourceImageryCheck";
import { SourcesField } from "@/components/sources/SourcesField";
import { SOURCE_FIELDS, sourceDraftFrom, type Source, type SourceDraft } from "@/lib/sources";
import { EVENT_FIELDS } from "@/lib/events";
import { IncompleteFormAnnouncer } from "@/components/ui/IncompleteFormAnnouncer";
import { FieldHelp } from "@/components/ui/FieldHelp";
import { SourceLabel } from "@/components/ui/SourceLabel";
import {
  ArchiveBox,
  ArchivedCopies,
  ArchiveSnapshotField,
  linkDescription,
} from "@/components/ui/ArchivedCopies";
import { StatusBadge } from "@/components/event/StatusBadge";
import {
  TEXT_LINK,
  TAPPABLE_HOVER,
  META_LINE,
  ACCENT_SURFACE,
  ACCENT_RAMP,
  CHART_TAIL,
  CHART_NEUTRAL,
  HOVER_REVEAL,
  ARMED_RING,
  WARNING_CALLOUT,
  TOOLTIP_SURFACE,
} from "@/components/ui/styles";
import {
  ACTION_ICONS,
  Button,
  buttonClasses,
  DANGER_CONFIRM,
  type ButtonAction,
} from "@/components/ui/Button";
import { CoordinateActions, CoordinateValue } from "@/components/event/CoordinateActions";
import { CoordinateInputs } from "@/components/geolocations/CoordinateInputs";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { Disclosure } from "@/components/ui/Disclosure";
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
  LIST_TILE,
} from "@/components/ui/form-styles";
import { Input, Select } from "@/components/ui/Input";
import { ErrorNotice, FieldError } from "@/components/ui/ErrorNotice";
import { LinkListInput } from "@/components/ui/LinkListInput";
import { safeHostname } from "@/lib/format";

/** Living style guide of every reusable primitive and variant, grouped by what you build. Dev reference, not in the nav. */

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

const MOCK_NO_ANSWER = {
  title: "Vidit does not respond",
  message: "Check your connection, then retry.",
  fields: {},
};

const MOCK_SERVER_FAULT = { title: "Vidit hit a problem", message: "Retry in a moment.", fields: {} };

// One label per action icon, so a new action shows here before it ships.
const ACTION_LABELS: Record<ButtonAction, string> = {
  accept: "Accept",
  activity: "Show all activity",
  add: "Add a source",
  approve: "Approve",
  archive: "Wayback Machine",
  askApproval: "Ask for approval",
  cancel: "Cancel",
  clear: "Clear",
  collect: "Add to collection",
  continue: "Continue",
  copy: "Copy",
  decline: "Decline",
  delete: "Delete",
  dismiss: "Dismiss",
  draw: "Draw a contour on this source",
  fileSource: "File the source",
  filter: "Filters",
  follow: "Follow",
  following: "Following",
  geolocate: "Geolocate",
  go: "Go",
  graphic: "Mark graphic",
  guide: "Read Getting started",
  hide: "Hide",
  import: "Import archive",
  invite: "Invite",
  leave: "Leave",
  less: "Manage",
  link: "Link",
  map: "Explore the map",
  mint: "Mint code",
  more: "Show more",
  newCollection: "New collection",
  newSite: "Create the site",
  next: "Next",
  password: "Update password",
  previous: "Previous",
  removePoint: "Remove corner",
  report: "Send report",
  request: "Post request",
  retry: "Retry",
  revert: "Back to the current contour",
  review: "Start reviewing",
  revoke: "Revoke",
  role: "Make org manager",
  save: "Save version 2",
  search: "Your geolocations",
  send: "Send reset link",
  show: "Restore",
  signIn: "Sign in",
  site: "Open the site page",
  skip: "Skip",
  undo: "Undo",
  unlink: "Clear link",
  unsubscribe: "Turn off",
  useProof: "Use a proof image",
  withdraw: "Withdraw",
};

const MOCK_TAGS = [
  { id: "1", name: "Ukraine" },
  { id: "2", name: "Drone" },
];

// A drone clip's source, shown on every detail surface: a file, two links, one archived.
const MOCK_SOURCE: Source = {
  id: "s1",
  title: "Drone footage of the strike",
  level: "direct",
  kind: "drone",
  captured_at: "2026-05-09T15:40:00Z",
  capture_position: { lat: 48.0201, lng: 37.7951 },
  is_graphic: false,
  links: [
    {
      url: "https://t.me/channel/4242",
      posted_at: "2026-05-09T15:45:00Z",
      archived: {
        url: "https://web.archive.org/web/20260601120000/https://t.me/channel/4242",
        provider: "wayback",
        archived_at: "2026-06-01T12:00:00Z",
      },
    },
    { url: "https://www.youtube.com/watch?v=mirror2", posted_at: null, archived: null },
  ],
  tags: [{ id: "t4", name: "armor" }],
  media: {
    id: "m1",
    role: "source",
    storage_url: "/opengraph-image",
    kind: "image",
    sha256: "0".repeat(64),
    original_filename: "strike.jpg",
  },
  warnings: [],
};

// A context source: an article, a URL only and no file.
const MOCK_CONTEXT_SOURCE: Source = {
  ...MOCK_SOURCE,
  id: "s2",
  title: "",
  level: "context",
  kind: "article",
  captured_at: null,
  capture_position: null,
  links: [{ url: "https://news.example/article", posted_at: null, archived: null }],
  tags: [],
  media: null,
};

// Reference imagery on a listed provider, for the provider check.
const MOCK_SATELLITE_SOURCE: Source = {
  ...MOCK_CONTEXT_SOURCE,
  id: "s3",
  kind: "satellite",
  links: [
    { url: "https://earth.google.com/web/@48.0201,37.7951,50a", posted_at: null, archived: null },
  ],
};

// A full geolocation, for the detail body + detection card.
const MOCK_DETAIL: EventDetail = {
  id: "demo",
  title: "Strike on a depot, Donetsk",
  coords: { lat: 48.0159, lng: 37.8024 },
  occurred_date: "2026-05-09",
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
  tags: [{ id: "t3", name: "Donetsk" }],
  conflicts: [
    {
      id: "c1",
      name: "Russian invasion of Ukraine",
      wikidata_id: null,
      start_year: 2022,
      end_year: null,
      is_ongoing: true,
      tier: "major",
    },
  ],
  sources: [MOCK_SOURCE, MOCK_CONTEXT_SOURCE],
  occurred_time: "15:45:00",
  detected_from_url: null,
  detected_via: null,
  proof: null,
  created_at: "2026-06-01T00:00:00Z",
  hidden_at: null,
  geolocated_at: "2026-06-03T10:00:00Z",
  closed_at: null,
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
  proof: '<img src="/local-storage/demo.jpg">',
  sources: [{ ...MOCK_SOURCE, kind: "unknown" }],
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
  sources: [],
};

// The same detail body with a provenance link, as an imported row carries it.
const MOCK_DETAIL_ARCHIVED: EventDetail = {
  ...MOCK_DETAIL,
  detected_from_url: "https://x.com/analyst/status/1234567890",
};

// The lighter geolocation-card payload (feed / recent-submissions shape).
const MOCK_CARD_GEO = {
  id: "demo",
  title: "Strike on a depot near Donetsk",
  occurred_date: "2026-05-09",
  status: "detected" as EventStatus,
  lat: 48.0159,
  lng: 37.8024,
  owner: { username: "analyst" },
  tags: [{ id: "t3", name: "Donetsk" }],
};

// Four tiles for the collection mosaic, the shape `GET /collections/{id}`
// hands over: one item's media per tile, in the order the collection lists its
// items. The app's own OG image stands in for the stored media, extensionless
// so `displayUrlsFor` finds no sibling and every size resolves to it.
const MOCK_COVER_TILES = [
  { url: "/opengraph-image", kind: "image" as const, role: "source" as const },
  { url: "/opengraph-image", kind: "image" as const, role: "source" as const },
  { url: "/opengraph-image", kind: "image" as const, role: "source" as const },
  { url: "/opengraph-image", kind: "image" as const, role: "source" as const },
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
    is_ongoing: true,
    tier: "major",
  },
  {
    id: "c2",
    name: "Sudanese civil war",
    wikidata_id: null,
    start_year: 2023,
    end_year: null,
    is_ongoing: true,
    tier: "minor",
  },
  {
    id: "c3",
    name: "Falklands War",
    wikidata_id: null,
    start_year: 1982,
    end_year: 1982,
    is_ongoing: false,
    tier: null,
  },
  {
    id: "c4",
    name: "Other",
    wikidata_id: null,
    start_year: null,
    end_year: null,
    is_ongoing: true,
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
    { id: "f1", name: "donetsk" },
    { id: "f2", name: "armor" },
    { id: "f3", name: "drone" },
    { id: "f4", name: "artillery" },
  ]);
  const [tpSelected, setTpSelected] = useState<string[]>([]);
  const [tpConflictSel, setTpConflictSel] = useState<string[]>([]);
  const [links, setLinks] = useState<string[]>(["https://t.me/channel/12345"]);
  const [paletteSources, setPaletteSources] = useState<SourceDraft[]>(() => [
    sourceDraftFrom(MOCK_SOURCE),
    sourceDraftFrom(MOCK_CONTEXT_SOURCE),
    sourceDraftFrom(MOCK_SATELLITE_SOURCE),
  ]);
  const [confirmOpen, setConfirmOpen] = useState<"accent" | "danger" | null>(null);

  return (
    <PageShell
      title="Palette"
      subtitle="Reusable building blocks, grouped by what you're building: tokens → controls → forms → content → containers → views. Everything follows the accent color (Settings → Display)."
    >
      <div className="space-y-8">
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

          <Item name="META_LINE" usage="A card's muted meta line with inline glyphs: the feed card's date and coordinates, a search hit's organization line">
            <span className={META_LINE}>
              <MapPin size={11} aria-hidden />
              Organization · 4 members
            </span>
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

          <Item name="ARMED_RING" usage="The armed half of a two-click confirm on a control that stays put: a ring plus a neutral plate, so the button reads as changed without moving or resizing anything. Applied via className over any variant, paired with useConfirmAction (which owns the arming, the timeout, and the Escape / outside-click exits) and a label that says what the next click does. Every armed control that is not the loud red point of no return uses it: the event share row's detection link, the event forms' publish buttons (through PublishActions). DANGER_CONFIRM is the destructive counterpart.">
            <div className="flex items-center gap-3">
              <Button action="geolocate" variant="primary" className={ARMED_RING}>
                Confirm
              </Button>
              <Button icon variant="ghost" className={ARMED_RING} aria-label="Copy coordinates" title="Copy coordinates">
                <Copy size={15} />
              </Button>
            </div>
          </Item>

          <Item name="WARNING_CALLOUT" usage="Amber caution surface: duplicate probe, tag-load failure, import notice. Colour only; callers add rounded-md + their own padding.">
            <div className={`rounded-md px-4 py-3 text-sm ${WARNING_CALLOUT}`}>
              Heads up, check this before submitting.
            </div>
          </Item>

          <Item name="<WithheldBanner>" usage="The state of an event, collection or site a moderator withheld (hidden_at), under the page header. Only an admin reads a withheld item, so only an admin meets it. Painted from WARNING_CALLOUT; `noun` names the item.">
            <WithheldBanner since="2026-10-28T09:30:00Z" noun="collection" />
          </Item>

          <Item name="TOOLTIP_SURFACE" usage="The bubble of an anchored popover (usePinnedPopover): the FieldHelp explanation, the ActionMenu list and the Tooltip bubble. Colour only; callers add rounded-md, padding and text size.">
            <span className={`inline-block rounded-md px-2 py-1 text-xs ${TOOLTIP_SURFACE}`}>
              maya
            </span>
          </Item>
        </section>

        {/* The two tone systems (<Button> / <Pill>) and the pills' consumers. */}
        <section className="space-y-3">
          <SectionEyebrow title="Controls · buttons & pills" />

          <Item name="<Button>" usage="Two axes: tone (accent / danger) and emphasis (filled → outline → text). Everything clickable is the accent colour, red is destructive or alerting, no grey button. `dangerGhost` is red at ghost weight, for a red control sitting in an icon row (the report flag). `DANGER_CONFIRM` is the one loud filled red, applied only to the armed two-click confirm. `disabled` drops the tone for neutral grey rather than fading it, so a button that refuses the click reads like every other inert control on the site. `icon` makes a square icon-only button, and every icon control on the site is that ghost icon button, at one size: a page-header cluster, the profile header row, the coordinates line, the archive mark beside a source link, a field's trailing adornment, all the same 32px square with the same hover plate. An action is <Button icon variant='ghost'>; navigation is buttonClasses('ghost', {icon: true}) on a <Link> or an <a>, so a control that navigates never nests a button inside an anchor; a control with nothing to act on is the disabled button, which paints itself neutral grey and leaves the tab order (an inert link becomes a disabled button, since a dead anchor is not a control). aria-label is the whole name, title repeats it, and only a tooltip that moves while the name holds still (a copy flash) may differ. Marks are 14px lucide or brand glyphs. A text button leads its label with the icon of the action it names: `action` on a <Button>, <ActionIcon> before the text of a buttonClasses link, one icon per action from ACTION_ICONS (see Action icons below). Both shapes take a phone tap step below `sm`, `TAP_STEP` for the text shape's height and `ICON_TAP_STEP` for the icon square; both are exported, so an interactive `<Pill>`, a `<FilterSection>` header toggle and the filter surfaces' quiet text controls take the height floor, and a square control smaller than this one (the settings accent swatch, a `<FileManager>` tile's remove control, the map scrubber's play and reset, the sidebar's community links) takes `ICON_TAP_STEP` and names its own desktop square beside it, rather than either inventing a second figure.">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button action="geolocate" variant="primary">Publish</Button>
                <Button action="add" variant="secondary">Add a source</Button>
                <Button action="cancel" variant="ghost">Cancel</Button>
                <Button action="delete" variant="danger">Remove</Button>
                <Button action="report" variant="dangerGhost">Send report</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-neutral-600 self-center">disabled:</span>
                <Button action="geolocate" variant="primary" disabled>Publish</Button>
                <Button action="add" variant="secondary" disabled>Add a source</Button>
                <Button action="cancel" variant="ghost" disabled>Cancel</Button>
                <Button action="delete" variant="danger" disabled>Remove</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-neutral-600 self-center">two-click confirm:</span>
                <Button action="delete" variant="danger">Remove</Button>
                <span className="text-neutral-600 self-center">→</span>
                <Button action="delete" variant="danger" className={DANGER_CONFIRM}>
                  Confirm
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-1 text-sm text-neutral-300">
                <span className="text-[11px] text-neutral-600 self-end pb-2">icon control:</span>
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
            </div>
          </Item>

          <Item name="ACTION_ICONS" usage="The action icons: one lucide icon per action a text button names, the same icon wherever that action appears. A text <Button> takes `action` and draws the icon before its label; a buttonClasses link puts <ActionIcon action> before its text; ConfirmDialog takes confirmAction for its confirm, ActionMenu takes action for a text trigger (Approve). Button.test fails on a text button that names no action. docs/design.md, Action icons, lists every label each icon goes with.">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ACTION_ICONS) as ButtonAction[]).map((action) => (
                <Button key={action} action={action} variant="secondary">
                  {ACTION_LABELS[action]}
                </Button>
              ))}
            </div>
          </Item>

          <Item name="<RemoveButton>" usage="The minor destructive variant (components/ui/RemoveButton.tsx): a red dangerGhost cross (X) named by what it removes (label), the name showing as its tooltip, that acts at once with no confirmation. For a removal that is minor or easily undone: dismissing a notification, a link row, a FileManager tile (as a corner disc), a draft co-geolocator pick, a pending co-geolocator invitation, an event held on a collection form, a site source marked for removal on the edit form (Keep restores it). `confirms` shows a trash instead, only on the edit form's Close, whose CloseEventDialog collects the required reason.">
            <div className="flex items-center gap-2">
              <RemoveButton label="Dismiss notification" />
              <RemoveButton confirms label="Close this geolocation" />
            </div>
          </Item>

          <Item name="<ConfirmButton>" usage="The important destructive variant (components/ui/ConfirmButton.tsx): red, it confirms in place, never in a dialog. The first click arms it (DANGER_CONFIRM, named Confirm …), a second click within ARM_MS acts; Escape, a click or focus elsewhere, or the timeout disarms it. `icon` is the square icon button named by label, with its action's icon from ACTION_ICONS (a trash for delete, EyeOff for hide, Ban for revoke); without it, a labelled danger button that keeps its label and icon, with `name` as the accessible name when the text alone is ambiguous. For an action that is important or hard to undo: removing a co-geolocator, deleting an approval, withholding a site, hiding a reported item or an event, removing a source, dropping a collection, revoking an invite code, leaving an event's credit or an organization, removing a member, soft or hard deleting an event. Click to arm.">
            <div className="flex flex-wrap items-center gap-2">
              <ConfirmButton icon label="Remove bo" onConfirm={() => {}} />
              <ConfirmButton icon action="hide" label="Withhold the site" onConfirm={() => {}} />
              <ConfirmButton action="leave" label="Leave" onConfirm={() => {}} />
              <ConfirmButton label="Remove" name="Remove bo" onConfirm={() => {}} />
            </div>
          </Item>

          <Item name="<ActionMenu>" usage="A trigger that opens a short list of links or actions (role=menu): the event header's version selector (v2 with a chevron: every version newest first as v3, v2, v1, then History as its icon), the edit page's More actions (an ellipsis holding the close), and the admin user card and invite rows (an ellipsis holding the secondary and destructive actions, each destructive one opening a ConfirmDialog). The trigger is the ghost button (`variant='primary'` when the menu is the page's main action, the event page's Approve as… with several identities), label as its aria-label and tooltip: icon-only by default, or `text` printed before the icon, in which case label starts with that text. menuLabel names the list when it differs from the trigger. Each item is a link (`href`) or an action (`onSelect`, a button that closes the menu, gives focus back to the trigger, then runs), with an optional icon and `current` for the link to the page on screen (the active-row paint plus aria-current, focused when the menu opens); `iconOnly` prints the icon alone, with the label as its accessible name and a Tooltip, for a list too narrow to print it. A click or Enter opens on the current item (or the first), ArrowUp on the trigger opens on the last; arrows, Home and End move, Space or Enter follows a link, Escape closes and returns focus to the trigger, Tab or an outside click closes. The list opens under the trigger aligned to its right edge, 14rem wide, shifts sideways to stay 8px inside the viewport, and scrolls past 20rem. `matchTriggerWidth` (off by default) makes it exactly as wide as the trigger, for a compact picker. It renders in a portal fixed to the viewport and follows the trigger on scroll, so a box that scrolls sideways never clips it.">
            <Variant label="default width">
              <ActionMenu
                label="Open the list"
                icon={<ChevronDown size={14} />}
                items={[
                  { key: "one", label: "First link", href: "/palette", current: true },
                  { key: "two", label: "Second link", href: "/palette" },
                ]}
              />
            </Variant>
            <Variant label="matchTriggerWidth (the version selector)">
              <ActionMenu
                label="v2: choose a version"
                text="v2"
                icon={<ChevronDown size={14} />}
                menuLabel="Versions"
                matchTriggerWidth
                items={[
                  { key: "v3", label: "v3", href: "/palette" },
                  { key: "v2", label: "v2", href: "/palette", current: true },
                  { key: "v1", label: "v1", href: "/palette" },
                  { key: "history", label: "History", icon: <History size={14} />, href: "/palette", iconOnly: true },
                ]}
              />
            </Variant>
          </Item>

          <Item name="<Popover>" usage="An icon button that opens a small panel anchored under it (role=dialog, named by label), for a control too small to sit in the page: the account picker behind the event forms' byline add button, and the event page's Add to collection and Geolocators. The panel floats over the page in a TOOLTIP_SURFACE bubble, 18rem wide, so nothing in the page moves when it opens. It renders in a portal fixed to the viewport, starts at the trigger's left edge, shifts sideways to stay 8px inside the viewport, and follows the trigger on scroll. The trigger is the ghost icon button with label as its aria-label and tooltip, in the active-row paint while open. children is a function handed the close, so a pick can close it; a field with autoFocus takes focus when it opens, or else the panel does, so Escape always reaches it. Escape closes it and returns focus to the trigger; an outside click closes it, and a click in a list a control in the panel owns (the Combobox list, portaled out) counts as inside. compact makes the trigger a 24px square on a desktop that takes no more height than a 20px line (the byline's add button). <PopoverPanel> is the panel alone, for a caller that owns its trigger: mounted while open, anchored under anchorRef, or above it when the room below is too short (it places itself again when its own size changes), its left edge on the anchor's or, with align=end, its right edge on the anchor's, and onClose handed whether to return focus (Escape) or not (an outside press); wide makes it 24rem for a row of choices that needs the room. The edit form's Save version N opens the version note in one, through PublishActions, and the map's basemap control opens its settings in a wide one above the button.">
            <Variant label="the byline's add button: an account picker">
              <Popover label="Invite a geolocator" icon={<UserPlus size={14} />}>
                {(close) => (
                  <AccountPicker
                    aria-label="Invite a geolocator"
                    options={[analystAccount({ username: "bo" }), analystAccount({ username: "cy" })]}
                    onSelect={close}
                    placeholder="Username"
                    emptyText="No analyst matches."
                    autoFocus
                  />
                )}
              </Popover>
            </Variant>
            <Variant label="compact, on a byline's line">
              <span className="inline-flex items-center gap-2 text-sm text-neutral-400">
                by ana
                <Popover label="Invite a geolocator" icon={<UserPlus size={12} />} compact>
                  {() => <p className="px-1 text-xs text-neutral-500">The picker goes here.</p>}
                </Popover>
              </span>
            </Variant>
          </Item>

          <Item name="<MapControlButton>" usage="A square icon button drawn like the MapLibre controls beside it: 29px, the panel paint and border of the zoom buttons, the native title as its tooltip like theirs, so a control the app adds to the map reads as one of the map's own. active paints the accent while what it opens is open; the rest of the button props pass through (aria-expanded, aria-controls, a ref for an anchored panel). components/map/MapPopoverControl.tsx is the one use, behind the basemap control and the go-to-coordinates control: MapLibre places the control's element in the bottom-left corner beside the zoom buttons, and the button opens a PopoverPanel above it.">
            <PaletteMapControlButton />
          </Item>

          <Item name="<Tooltip>" usage="The label of an icon-only control in a TOOLTIP_SURFACE bubble, while a mouse rests on it or the keyboard focuses it; a touch never opens it, so a tap leaves nothing standing, except with tapToShow (the AvatarStack pictures, the CountBadge count), where a touch's first tap pins the bubble and the second follows the link. underParent hangs the bubble under the wrapper's parent rather than under the control (a CountBadge's list under the button it counts for). Placement and dismissal (Escape, scroll, resize, an outside click) are usePinnedPopover's. <Button icon> renders its button through TooltipButton, so every icon button gets it with no call-site change: the tip is `title` when it differs from the name (a longer hint) and the aria-label otherwise, and the native title is dropped so no second tooltip appears. An icon link (buttonClasses on a Link or an a) wraps itself in <Tooltip label>, a display: contents span that leaves the layout alone. The bubble is aria-hidden, since the control's accessible name already says it.">
            <Variant label="icon button (hover or tab to it)">
              <Button icon variant="ghost" aria-label="Copy coordinates">
                <Copy size={14} />
              </Button>
            </Variant>
            <Variant label="icon link">
              <Tooltip label="Wayback Machine copy of the source">
                <a
                  href="#"
                  aria-label="Wayback Machine copy of the source"
                  className={buttonClasses("ghost", { icon: true })}
                >
                  <Archive size={14} />
                </a>
              </Tooltip>
            </Variant>
          </Item>

          <Item name="<CountBadge>" usage="A red count on a control's top-right corner of what it still lacks: the missing conditions on Publish geolocation and Publish request on submit, on Publish in the edit form of a request or a detection, and the fields a collection's Create or Save still refuses. The count is a danger <Pill> on a button beside the control, never inside it, and the wrapper keeps 8px clear on the right for its overhang. Its label (2 missing: Title, Conflict) is the badge's accessible name and shows under the control in a <Tooltip tapToShow underParent> on hover or keyboard focus, or on a tap on a touch screen, where the badge's hit area grows to about 36px up and into the control's corner; a tap on the control itself still acts. The control's aria-describedby points at a hidden copy of the label, so it says what is missing. No badge at a count of 0.">
            <Variant label="hover or tab to the count">
              <CountBadge count={2} label="2 missing: Title, Conflict">
                {(describedBy) => (
                  <Button action="geolocate" variant="primary" aria-describedby={describedBy}>
                    Publish
                  </Button>
                )}
              </CountBadge>
            </Variant>
          </Item>

          <Item name="<CopyButton>" usage="The one copy confirmation: an icon button whose mark turns into a check while `copied` holds (useCopyToClipboard times it, 1.5 s) and fades back after, with no fade under prefers-reduced-motion. The accessible name never changes, since a changing name is re-announced as a new control; its tooltip reads `announce` while the check shows, shown on its own (a tap included), and a sibling aria-live region says it to screen readers. Worn by Copy coordinates, a profile's copied handle, and Share where the browser has no share sheet (Link copied). The secondary `variant` boxes the button, for a copy that stands beside a field as its own item (Copy coordinates).">
            <Variant label="ghost (default)">
              <PaletteCopyButton />
            </Variant>
            <Variant label='variant="secondary"'>
              <PaletteCopyButton variant="secondary" />
            </Variant>
          </Item>

          <Item name="<ActiveFilterPills>" usage="The one rendering of active filters: a row of removable accent key/value chips (filter name, value, ×), shared by the map's filter overlay and the filter rail so active filter state reads identically everywhere. Each pill names its filter as the field label reads and its value as the chip reads (Approvals: Approved only, Author: ana). Entries are {key, filter, label, icon?, onRemove}; `onClearAll` adds a quiet clear-everything affordance once two or more filters are on. Renders nothing when the list is empty.">
            <PaletteActiveFilterPills />
          </Item>

          <Item name="<FilterSection>" usage="One collapsible filter row (chipSummary / rangeSummary build its collapsed one-line summary, orange when active). Open state is parent-owned (open + onToggle) so re-renders never reset the accordion; the optional `concept` wires the shared FieldHelp `?`. EventFilterSections opens on Show, Conflict and Tags, each under its <FieldLabel> and always in view, then stacks the collapsible rows in one fixed order; filters that belong together share one row, each under a <FieldLabel>, and the row sums up their active values. Shared by the map overlay, search, the Requests board and the feed.">
            <PaletteFilterSection />
          </Item>

          <Item name="<ChipBucket>" usage="A multi-select chip bucket for one small fixed filter family (Show, which the map ends with its Sites layer chip, as in the demo, source kind, level, media, location guess, Approved only): every option a <Pill>, selected ones filled accent, click toggles membership. Any-match within the bucket; combining buckets is AND on the server. An open catalogue (conflicts, tags) takes the filter search fields instead.">
            <PaletteChipBucket />
          </Item>

          <Item name="<ConflictChips filter> / <TagChips filter>" usage="The Conflict and Tags sections of the shared filter panel: the event form's search fields in filter mode. Each picks by name, the value the URL carries, from the panel's own catalogue of values in use (GET /conflicts?used=true, GET /tags), shows the picks as accent chips that remove on click, and keeps a picked name its catalogue lacks on show. The conflict field offers every conflict in use, ended ones included, with no label row and no switch; the tag field has no Create row and never calls POST /tags.">
            <PaletteFilterSearchFields />
          </Item>

          <Item name="<ToggleRow>" usage="An on/off row: an empty button over the whole row is the switch (role + click), the <Switch> rendering as its visual span, and it takes the phone tap step. `concept` puts a <FieldHelp> after the label in the settings shape, stacked above that button, so a tap on the `?` opens its help and never toggles (the basemap control's layers and overlays). `leading` puts a small picture before the text in the settings shape, as on <ActionRow> (the event page's Add to collection leads each row with the collection's cover). `description` picks the shape: without one the row is the filter toggle, a micro uppercase label on a divided list; with one it is a settings preference, the label at reading size over a line saying what the preference does. The accessible name is the label alone (aria-label), never the paragraph under it, which is its description. `className` carries the caller's own divider and spacing. `disabled` reads the state but refuses the toggle, dimmed, with a `description` saying why (a satellite source the event form cannot file on a site). Settings lists one described row per notification kind, its Email switch.">
            <PaletteToggleRow />
          </Item>

          <Item name="<ChoiceRow>" usage="A pick-one preference row, the <ToggleRow> shape for a setting with a few named choices: the label at reading size over a line saying what the setting does, and a <SegmentedControl> named by the label. `concept` puts a <FieldHelp> after the label (the basemap control's label language and density). Beside the text from sm up; below sm the bar drops under it and takes the full column. `className` carries the caller's own divider and spacing. Settings and the organization page both render Accept approval requests from through it.">
            <PaletteChoiceRow />
          </Item>

          <Item name="<ActionRow>" usage="A row that is one action on a named thing, the sibling of <ToggleRow> and <ChoiceRow>: an optional small picture (leading), the label at reading size over a muted line, and the action's verb at the right edge. The whole row is the button, with the accent wash on hover and keyboard focus. The verb (+ Add) shows on hover and keyboard focus, through HOVER_REVEAL, and always on a touch screen. done is the static state that takes the verb's place once the row has acted (an accent Added N pill with a check); the row then stops acting. disabled refuses the action while another write runs, dimmed. aria-label names the action and its target until done. The search page's bulk Add to collection lists the owner's collections through it, each led by its CollectionCover tile at 40px, in the CollectionPicker the event page's switches share.">
            <div className="w-full max-w-sm space-y-0.5">
              <ActionRow
                label="Kupiansk rail corridor"
                description="12 events"
                actionLabel="Add"
                aria-label="Add to Kupiansk rail corridor"
                onAct={() => {}}
                className="py-1.5"
              />
              <ActionRow
                label="Dam breach"
                description="44 events"
                actionLabel="Add"
                onAct={() => {}}
                className="py-1.5"
                done={
                  <Pill tone="accent" icon={<Check size={11} />}>
                    Added 44
                  </Pill>
                }
              />
            </div>
          </Item>

          <Item name="<Pill>" usage="One pill for the whole family (status, tag, filter, badge) at one size. `tone` = accent | secondary | neutral | danger | warning, mirroring the <Button> tones (secondary is the accent outline, no fill); warning is the `WARNING_CALLOUT` paint, for a site link effect of damage beside the danger tone of a destruction. A static <span> by default; pass `onClick` and it becomes an interactive chip (a <button> that brightens on hover), the caller driving the tone off its active state. `label` makes a key/value pill, the key muted before the value (`Conflict: Russo-Ukrainian war`), for a field whose name the value alone does not carry; lib/cardTags.ts keys a card's conflicts; a source block keys its kind and drops an Unknown value. className merges via cn (caller wins on a conflicting utility); keep it to orthogonal extras, the size stays one.">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-neutral-600 self-center w-12">static</span>
                <Pill tone="accent" icon={<MapPin size={11} />}>
                  accent
                </Pill>
                <Pill tone="secondary">secondary</Pill>
                <Pill tone="neutral">neutral</Pill>
                <Pill tone="danger">danger</Pill>
                <Pill tone="warning">warning</Pill>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-neutral-600 self-center w-12">keyed</span>
                <Pill label="Conflict">Russo-Ukrainian war</Pill>
                <Pill label="Kind">Smartphone</Pill>
                <Pill>airstrike</Pill>
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
            </div>
          </Item>

          <Item name="<SegmentedControl>" usage="Exclusive-choice bar: submit mode (single / bulk import), admin delete mode (soft / hard), the detections queue filter, the feed scope (following / all). tone=danger paints a destructive option's active state red; fullWidth stretches the track at every width, and below sm the track always stretches, each option starting from its label's width so the longest label stays whole. A one-word label that needs a sentence takes a <FieldHelp> beside the bar, never hover text of its own.">
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

          <Item name="<SwatchPicker>" usage="Pick-one-colour field: round swatches in an ARIA radiogroup named by `aria-label`. The selected swatch is the one tab stop (the first while none is), the arrow keys move focus and selection together and wrap, Home and End jump to the ends, and a click selects. The selected swatch wears a light ring and the focused one an accent ring. A 36px target below sm, a 24px disc from sm up. Settings → Display uses it for the accent colour.">
            <PaletteSwatchPicker />
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

        {/* Everything you touch building a form. */}
        <section className="space-y-3">
          <SectionEyebrow title="Forms" />

          <Item name="<Input> (+ FORM_INVALID_FIELD, FieldAdornment, TRAILING_ROOM, LOCKED_FIELD)" usage="The one form field: variant (default / compact / locked) + invalid + icon + trailing. `<Input invalid>` is sugar over the FORM_INVALID_FIELD red-outline token; the same raw token flags non-input surfaces too (media dropzone, proof editor, section cards). `icon` overlays a leading icon at the leading edge, inert. `trailing` is the field's own action slot at the other edge, centred on the field's height and taking the pointer: the picker of a <DateTimeInput>, the Wayback Machine door of a snapshot field. Each one is a ghost icon button, the site's one icon control, set a hair apart so two hover plates read as two controls; the field is one height across the three variants so that 32px square sits inside any of them with a 3px gutter, and the text padding grows by TRAILING_ROOM so a long value never runs under them, both figures stepping together on a phone. FIELD_TEXT is the one field type size, 16px below `sm` and 14px above, run by all three variants and by <Select> and <Textarea>, since Mobile Safari zooms a page in on a field under 16px and never zooms back out. `trailingFromSm` is for a field too narrow on a phone to hold both its value and a 36px mark (the instant field at 320px): the slot renders from `sm` up only and the field takes its room there only, so what the mark acts on has to stay reachable without it, the way a date field falls back to a tap opening the engine's picker. FieldAdornment + TRAILING_ROOM are exported for the one field that is not an input: <LockedUrl> renders a frozen value as an anchor in LOCKED_FIELD, the locked variant's box without its not-allowed cursor, and clears the same adornment by the same amount. Native props + className pass through.">
            <div className="w-full max-w-sm space-y-2">
              <Variant label="default">
                <Input placeholder="Type here..." />
              </Variant>
              <Variant label="icon (search box)">
                <Input icon={<SearchIcon size={14} />} type="search" placeholder="Search…" />
              </Variant>
              <Variant label="trailing (the field's own actions)">
                <Input
                  placeholder="https://t.me/channel/12345"
                  trailing={
                    <Button icon variant="ghost" aria-label="Clear the field">
                      <X size={14} />
                    </Button>
                  }
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
                  <option value="">Pick a kind</option>
                  <option value="drone">Drone</option>
                </Select>
              </Variant>
            </div>
          </Item>

          <Item name="<DateTimeInput>" usage="A date, a time or an instant: the native control wearing the site's own mark. The browser draws its picker button in engine chrome at engine size, which on the dark field reads as a foreign element; the brick sets `.picker-glyph` (globals.css hides that button, Webkit/Chromium only) and puts a ghost icon button in the field's trailing slot instead, Calendar for anything picking a day and Clock for a time of day, opening the same native picker through showPicker() and falling back to focusing the field. One brick for the event date, the event time, a source's capture time and each link's post time, on every event form. It also owns `has-value`, the class globals.css mutes an empty field's dd/mm/yyyy placeholder off, so no call site derives it. A date field too narrow for an adornment (the search filters, the map scrubber) stays a bare Input of type date and keeps the native button. The mark is a desktop affordance: below `sm` a field cannot hold both a 36px button and the value of an instant, so the slot stands down (`trailingFromSm`) and a tap on the field opens the engine's picker.">
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

          <Item name="<CoordinateInputs>" usage="The latitude and longitude pair of every event form (components/geolocations/CoordinateInputs.tsx): the Location block's subject point and each source's capture position. One line at every width, the 320px source editor included: Latitude and Longitude share the room in two shrinking columns with no visible label (each field is named by its aria-label and shows an example value as its placeholder), and <CoordinateActions> follows them as its own two boxes, centred on the fields. The fields run half the usual side padding and tight tracking, so a 6-decimal value shows whole from 375px up and in the forms' side column. A paste that reads as a pair (lat, lng, or a Google Maps URL) fills both fields from either one. `idPrefix` keeps a capture pair's ids apart from the subject's; `required={false}` for the optional capture pair; `invalid` reddens both fields. A typed value that is not a number in decimal degrees or falls out of bounds reddens its field at once with the reason in a <FieldError> under the line (pairProblem in lib/coordinates.ts); a blank half waits for the publish on the subject pair, and on the optional capture pair says the position is not saved.">
            <PaletteCoordinateInputs />
          </Item>

          <Item name="<CoordinateActions> / <CoordinateValue>" usage="The two things anyone does with a coordinate pair (components/event/CoordinateActions.tsx): View on Maps (a new tab) and Copy coordinates (the 6-decimal pair, through <CopyButton>). Two outlined icon buttons, each its own box, everywhere they appear: after the two fields of <CoordinateInputs> and on the event page's Coordinates row. A null pair (half-typed or out of bounds) keeps both in place, disabled and grey; the map link becomes a disabled button then, named and tooltipped with the reason (`problem`): No map link. Latitude must be between -90 and 90. `small` is the 24px desktop square for a dense row. <CoordinateValue> is a reading row's value: the pair, then the actions; `compact` fits a narrow card on one line, 4 decimals and the small actions.">
            <Variant label="a complete pair">
              <CoordinateActions lat={48.015883} lng={37.802411} />
            </Variant>
            <Variant label="half-typed (disabled)">
              <CoordinateActions lat={null} lng={null} />
            </Variant>
            <Variant label="small">
              <CoordinateActions lat={48.015883} lng={37.802411} small />
            </Variant>
            <Variant label="<CoordinateValue>">
              <CoordinateValue lat={48.015883} lng={37.802411} />
            </Variant>
          </Item>

          <Item name="<LinkListInput>" usage="An ordered list of links, one row each, with one add button: each source editor's Links. A row is the URL field, the caller's `columns`, then the remove control (a red dangerGhost cross), so the control sits at the end of the row it removes. `heading` (default Links) labels the list and carries the caller's help: it is the URL column's header on a wide list and a label above the cards on a narrow one, red while `invalid`. A row is the caller's own value, read and written through `urlOf` / `withUrl`, so what else it carries (a post time, an archived copy) moves with it through adds and removals. `max` mirrors the server cap and disables add at the ceiling. Blank rows are the caller's to drop at assembly. Each other column names its header and its grid track; `expansion` is a line across the row while the row is toggled open, and every row starts closed. On a source editor the columns are the post time and the <ArchiveBox>, and the expansion is the <ArchiveSnapshotField> paste line. The list is its own container: from `@xl` (36rem) the rows share one grid under a header line, so each column keeps one width down the list. Narrower, each row is a small card: the URL with the remove control at the card's top right, the columns wrapping under it.">
            <div className="w-full space-y-4">
              <Variant label="with a post time and an archive box per row (a wide list)">
                <LinkListInput<string>
                  rows={links}
                  onChange={setLinks}
                  urlOf={(url) => url}
                  withUrl={(_, url) => url}
                  blank={() => ""}
                  max={3}
                  itemLabel="Link"
                  placeholder="https://x.com/user/status/12345"
                  heading={
                    <>
                      Links <FieldHelp concept="source_links" />
                    </>
                  }
                  columns={[
                    {
                      header: "Posted (UTC)",
                      width: "13rem",
                      cell: ({ index }) => (
                        <DateTimeInput
                          type="datetime-local"
                          variant="compact"
                          aria-label={`Posted (UTC), link ${index + 1}`}
                          value=""
                          onChange={() => {}}
                        />
                      ),
                    },
                    {
                      header: "Archive",
                      width: "auto",
                      cell: ({ index, row, expanded, toggle }) => (
                        <ArchiveBox
                          describes={linkDescription(0, safeHostname(row), index, links.length)}
                          snapshot={index === 0 ? "https://archive.ph/abcde" : ""}
                          expanded={expanded}
                          onToggle={toggle}
                        />
                      ),
                    },
                  ]}
                  expansion={({ index, row }) => (
                    <ArchiveSnapshotField
                      link={row}
                      describes={linkDescription(0, safeHostname(row), index, links.length)}
                      value=""
                      onChange={() => {}}
                    />
                  )}
                />
              </Variant>
              <Variant label="URLs only, in a narrow column: each row a card (max 3 here)">
                <div className="max-w-sm">
                  <LinkListInput<string>
                    rows={links}
                    onChange={setLinks}
                    urlOf={(url) => url}
                    withUrl={(_, url) => url}
                    blank={() => ""}
                    max={3}
                    itemLabel="Link"
                    placeholder="https://x.com/user/status/12345"
                  />
                </div>
              </Variant>
            </div>
          </Item>

          <Item name="<Disclosure>" usage="A ghost toggle, a chevron and a label, that shows or hides a block of secondary fields under it: a source editor's **Capture details** (capture time, capture position, tags, graphic flag). The parent owns `open` and `onToggle`, so it decides the first state (a source editor opens it when a field inside holds a value). The block stays mounted while closed (`hidden`), so a field keeps what it holds; `aria-expanded` and `aria-controls` tie the toggle to it.">
            <PaletteDisclosure />
          </Item>

          <Item name="FORM_LABEL (+ _COMPACT, LABEL_TEXT, FORM_INVALID_LABEL)" usage="Field labels, kept separate from <Input>. LABEL_TEXT is the bare 11px uppercase text (FORM_LABEL minus block) for block hosts: table head rows, group headings, the error-digest label. FORM_INVALID_LABEL is FORM_INVALID_FIELD's label-side companion: every required field appends it to its own label alongside the input's FORM_INVALID_FIELD outline, so the two always turn red together.">
            <div className="space-y-2">
              <label className={FORM_LABEL}>Field label</label>
              <label className={FORM_LABEL_COMPACT}>Compact label</label>
              <label className={`${FORM_LABEL} ${FORM_INVALID_LABEL}`}>
                Invalid field label
              </label>
            </div>
          </Item>

          <Item name="<FieldLabel>" usage="The label row over a form control, the edit side of a field table (EVENT_FIELDS in lib/events.ts, SOURCE_FIELDS in lib/sources.ts) whose read side is <DetailRow>: spread the table entry ({ label, concept }) into either, so a field reads under one name with one ? on the page and in the form. The words, then the ? outside the <label> (so the field's accessible name is the words alone), then trailing (a <CharCounter>, a LockedHint). htmlFor makes the words a <label>; without it they are a span, for a control that names itself (a segmented control, a switch, a file slot). invalid turns the row red with FORM_INVALID_LABEL. Every event form label, the source editor's, and the version note's take it.">
            <div className="w-full max-w-sm space-y-3">
              <FieldLabel {...EVENT_FIELDS.occurred_date} htmlFor="palette-field-label" />
              <FieldLabel {...EVENT_FIELDS.coordinates} invalid />
              <FieldLabel
                {...SOURCE_FIELDS.title}
                trailing={<CharCounter length={12} max={200} />}
              />
            </div>
          </Item>

          <Item name="<CharCounter>" usage="How much of a capped free-text field is used: `length / cap`, red once the value runs over. One counter for every capped free-text field (the profile bio, a collection's title and description, the event title, the close reason, the report details), so no two spell the reading differently. It turns red exactly when the submit refuses the value, so the colour and the count on the submit always agree. The figure alone, no label and no box: a caller sits it at the far end of the field's label row.">
            <div className="flex w-full max-w-sm items-center justify-between gap-2">
              <label className={FORM_LABEL}>Bio</label>
              <CharCounter length={120} max={500} />
            </div>
            <div className="flex w-full max-w-sm items-center justify-between gap-2">
              <label className={FORM_LABEL}>Over the cap</label>
              <CharCounter length={512} max={500} />
            </div>
          </Item>

          <Item name="<ErrorNotice>" usage="The one error display: a form's refusal above its actions, a failed read in place of its section. A fault the reader did not cause leads with its title and offers Retry; a refusal is one line with no Retry.">
            <div className="w-full max-w-md space-y-3">
              <Variant label="no answer, with onRetry">
                <ErrorNotice error={MOCK_NO_ANSWER} onRetry={() => {}} />
              </Variant>
              <Variant label="server fault, with onRetry">
                <ErrorNotice error={MOCK_SERVER_FAULT} onRetry={() => {}} />
              </Variant>
              <Variant label="refusal (one line, never a Retry)">
                <ErrorNotice error="This invite code was already used." />
              </Variant>
            </div>
          </Item>

          <Item name="<FieldError>" usage="The refusal of one field, under it, with the field's aria-describedby on its id (ErrorNotice.tsx)">
            <div className="w-full max-w-sm space-y-1.5">
              <FieldLabel label="Invitee's X handle" htmlFor="palette-field-error" invalid />
              <Input
                id="palette-field-error"
                invalid
                defaultValue="@this_handle_is_too_long"
                aria-describedby="palette-field-error-text"
              />
              <FieldError id="palette-field-error-text">15 characters at most: letters, digits and _.</FieldError>
            </div>
          </Item>

          <Item name="FORM_ERROR_BANNER" usage="The red notice paint that is not an error display: the session-ended notice, an X post import that wrote nothing">
            <div className={`${FORM_ERROR_BANNER} max-w-sm`}>Nothing was imported from this post.</div>
          </Item>

          <Item name="FORM_SUCCESS_BANNER" usage="Confirmation / info notice (password updated, reset). Orange, not green.">
            <div className={`${FORM_SUCCESS_BANNER} max-w-sm`}>Saved.</div>
          </Item>

          <Item name="LIST_TILE" usage="One item of a list: a source block or a source editor, a report, a detection stat, the user actions. A bordered tile on the panel; the caller adds the spacing between its lines.">
            <div className={`${LIST_TILE} max-w-sm space-y-2 text-sm text-neutral-300`}>
              <p>@osint_hawk_2025</p>
              <p className="text-xs text-neutral-500">Requested 2 days ago</p>
            </div>
          </Item>

          <Item name="<IncompleteFormAnnouncer>" usage="Reads every unmet required field to a screen reader in one sentence, on each blocked attempt (submit / validate / request, the collection form, and the sign-in, registration, password and invite forms). It shows nothing: the fields and labels turn red in place and a publish button's CountBadge lists them. A polite live region (role=status, sr-only) stays mounted, and attempt (useIncompleteForm's validationAttempt) re-keys the sentence so a repeat attempt is read again. Every form sets noValidate; the blank fields come from blankFields and the key set from useIncompleteForm.">
            <div className="w-full max-w-sm text-xs text-neutral-500">
              Visually hidden. Its sentence here: Fill in the required fields before continuing:
              Coordinates, Conflict, Proof.
              <IncompleteFormAnnouncer missing={["Coordinates", "Conflict", "Proof"]} attempt={1} />
            </div>
          </Item>

          <Item
            name="<FieldHelp>"
            usage="The one explanation hover text in the app: a `?` on a label, a section heading, a filter bar or an icon group, whose bubble carries the concept's sentence from the lib/fieldHelp.ts registry (a native title attribute is never used). Registry-only: every instance of a concept reads the same words, so the `?` takes the concept key and nothing else. A concept whose data comes from outside Vidit lists its sources under the sentence, each a link that opens the provider's page in a new tab (the basemap control's presets, layers and overlays); the bubble then stays open while the pointer crosses into it, and a press on a link inside a popover panel keeps the panel open."
          >
            <span className="inline-flex items-center gap-3 text-sm text-neutral-300">
              <span className="inline-flex items-center gap-1">
                Coordinates <FieldHelp concept="coordinates" />
              </span>
              <span className="inline-flex items-center gap-1">
                Relief <FieldHelp concept="map_relief" />
              </span>
            </span>
          </Item>

          <Item name="<TagPicker>" usage="The classification fields of every event form, last in its Details card: the conflicts, then the tags as <TagChips>. The conflict field shows the picked conflicts as accent chips that remove on click, over a <Combobox> named Conflict that lists nothing at rest and, on focus or typing, the ongoing conflicts whose name holds the typed text (case-insensitive), by tier then name, with Other pinned last and always offered. The Include ended conflicts switch on the label row adds the ended ones. <TagChips> shows the picked tags as accent chips that remove on click, over a <Combobox> that suggests the other tags of the one catalogue whose name holds the typed text (case-insensitive) and, when no tag bears the exact typed name, ends the list with Create &quot;name&quot;, which creates the tag and picks it. The list stays open after a pick. Under the search, neutral <Pill> chips with a plus offer the suggested tags (GET /tags/suggested: your most used tags, then the platform's), the picked ones left out; a click picks the tag. The chips wrap, the first 6 show, and one Show more shows the rest. Each source editor renders <TagChips> alone, named for its source (Source 1 tags). The conflict field is <ConflictChips>; with filter, both fields serve the filter panel (see the filter search fields).">
            <div className="w-full max-w-2xl space-y-4">
              <TagPicker
                tags={tpTags}
                setTags={setTpTags}
                suggestedTags={tpTags}
                selectedTagIds={tpSelected}
                setSelectedTagIds={setTpSelected}
                conflicts={MOCK_CONFLICTS}
                selectedConflictIds={tpConflictSel}
                setSelectedConflictIds={setTpConflictSel}
              />
            </div>
          </Item>

          <Item name="<Combobox>" usage="The keyboard and the list of every typeahead: a role=combobox <Input> over a role=listbox list in a portal fixed to the viewport, painted with TOOLTIP_SURFACE, as wide as the field, scrolling past 15rem and opening above the field when the room below is short, following the field on every frame and kept inside the viewport. The caller owns the query, the open state, the filtered options and how a row renders; a status string shows as a muted row under the options, and a heading as a muted row over them, naming what they are (Search results in the site and event link pickers). ArrowUp and ArrowDown move and wrap, Enter picks the highlighted row or hands the text to onSubmitText, Escape or a blur closes. pillOption shows a row inside a neutral <Pill>, the chip a pick becomes: every conflict and tag row, never the Create row. <AccountPicker>, <ConflictChips>, <TagChips>, the admin event field and the collection picker's Add events build on it.">
            <PaletteCombobox />
          </Item>

          <Item name="<AccountPicker>" usage="The one way to pick an analyst or an organization: a combobox field (role=combobox over a role=listbox) whose rows show the picture (a circle for an analyst, a rounded square for an organization), the name and, for an organization, its slug muted. `options` filters a local list by name and handle; `search` runs the caller's request 250ms after typing stops, once the query holds `minQueryLength` characters, and a `note` it returns (why an exact match is left out) shows as a muted row. Loading, a failed search and `emptyText` are muted rows too. ArrowUp and ArrowDown move and wrap, Enter takes the highlighted row or hands the typed text to `onSubmitText` when no row is up (an exact username), Escape, Tab or an outside click closes. With `selected`, the pick shows as an accent chip that `onClear` removes; without it, the field empties after each pick. The list spans the field's width and scrolls past 15rem. It renders in a portal fixed to the viewport, so a card or a scrolling rail never clips it, and it opens above the field when the room below is shorter than 15rem and the room above is larger. Consumers: the approval request, the search Author filter, the co-geolocator invite, the organization invite, the admin org manager fields and the admin analyst search.">
            <PaletteAccountPicker />
          </Item>
        </section>

        {/* Small display pieces that fill rows, cards, and headers. */}
        <section className="space-y-3">
          <SectionEyebrow title="Content" />

          <Item name="<Avatar>" usage="The profile-picture circle: profile header (icon), feed card author circle via EntityCard + user search results (initial), sidebar identity row (icon, in the rail's 18px glyph box). `size` is the only dimension a caller sets: the icon fallback scales with the circle. A picture that fails to load falls back to the same circle (an avatar_url names a server-minted object on the media host, which a replace or remove deletes and a CDN edge can answer for before a new one propagates), and a new picture retries. iconClassName colours the icon fallback (the sidebar passes text-current so it tracks hover + the active accent); decorative drops the alt text where the host already names itself. shape=&quot;square&quot; rounds the corners instead, for an organization beside analysts (AvatarStack). Renders a <div>; as=&quot;span&quot; for phrasing-content hosts (the AuthorByline's avatar variant, the sidebar row's badge anchor).">
            <Variant label='fallback="icon" (profile header)'>
              <Avatar username="demo" size="w-11 h-11" fallback="icon" />
            </Variant>
            <Variant label='fallback="icon" (larger circle)'>
              <Avatar username="demo" size="w-16 h-16" fallback="icon" />
            </Variant>
            <Variant label='fallback="initial"'>
              <Avatar username="ana-demo" size="size-10" />
            </Variant>
            <Variant label='shape="square" (an organization)'>
              <Avatar username="Open Source Watch" size="size-10" shape="square" />
            </Variant>
            <Variant label="src that fails to load (falls back)">
              <Avatar
                username="ana-demo"
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

          <Item name="<AvatarStack>" usage="A row of 28px pictures: the approval stamps under the event page's actions and the organization logos in a profile header, oldest first, overlapping by default; spacing=gap sets them apart and wraps them onto further lines (the approval stamps). checked puts a 14px check badge in the reader's accent on each picture's bottom-right corner, ringed in the page colour (the approval stamps). An organization (variant=organization) takes the rounded square, an analyst the circle. Each picture is a link to its href (the profile or the organization's page) named by its label, which a <Tooltip tapToShow> shows on hover or keyboard focus, or on a first tap on a touch screen, where the second tap follows the link (who approved which version when, on a stamp; the role on a logo). An item's remove puts a 20px remove disc on the picture's top-right corner, revealed by HOVER_REVEAL on hover or keyboard focus and pinned visible on a touch screen, where its hit area is a 36px square up and right of the disc and the picture takes room for it (a site admin's delete of a stamp, a co-geolocator taken off the edit form's byline). muted fades a picture to half opacity, for an account not credited yet (a pending co-geolocator invitation). size=sm takes the 20px picture of a page byline with a 16px remove disc: the event page's co-geolocators (through AuthorByline) and an event form's managed ones are the same pictures at the same gap, so the two bylines line up; size=xs is the 16px picture of a card's byline. Only overlapping pictures take the page-colour ring; set apart, a picture takes the focus ring alone. trailing follows the last picture on its line, out of the list's items (the approvals' ?). At most max (5 by default) show; the rest fold into a +N bubble, a button when onOverflow is set and plain text otherwise; the approval stamps pass every item, so no count shows. Renders nothing for an empty list.">
            <Variant label="analysts and an organization, max=3 with onOverflow (+N opens the panel)">
              <AvatarStack
                label="Approved by"
                max={3}
                onOverflow={() => {}}
                overflowLabel={(hidden) => `Show ${hidden} more approvals`}
                items={paletteApprovalStamps(PALETTE_APPROVERS.slice(0, 5))}
              />
            </Variant>
            <Variant label="spacing=gap and checked: pictures set apart with an accent check, wrapping onto a second line (the event page's approval stamps)">
              <div className="w-56">
                <AvatarStack
                  label="Approved by"
                  max={PALETTE_APPROVERS.length}
                  spacing="gap"
                  checked
                  items={paletteApprovalStamps(PALETTE_APPROVERS)}
                />
              </div>
            </Variant>
            <Variant label="remove that confirms in place: hover or focus a picture for its trash (a site admin's stamps)">
              <AvatarStack
                label="Approved by"
                spacing="gap"
                checked
                items={paletteApprovalStamps(PALETTE_APPROVERS.slice(0, 3)).map((stamp) => ({
                  ...stamp,
                  remove: { label: `Delete approval by ${stamp.name}`, onClick: () => {}, confirms: true },
                }))}
              />
            </Variant>
            <Variant label="muted with a cross that acts at once: pending co-geolocators on an event form's byline">
              <AvatarStack
                label="Co-geolocators"
                spacing="gap"
                max={Infinity}
                items={["bo", "cy"].map((name) => ({
                  key: name,
                  name,
                  variant: "analyst" as const,
                  label: `${name}, invitation pending`,
                  href: "/palette",
                  muted: true,
                  remove: { label: `Withdraw the invitation of ${name}`, onClick: () => {} },
                }))}
              />
            </Variant>
            <Variant label="organization logos with role labels (the profile header)">
              <AvatarStack
                label="Organizations"
                items={[
                  { name: "Open Source Watch", role: "Org manager" },
                  { name: "Sahel Desk", role: "Member" },
                ].map(({ name, role }) => ({
                  key: name,
                  name,
                  variant: "organization" as const,
                  label: `${role} of ${name}`,
                  href: "/palette",
                }))}
              />
            </Variant>
          </Item>

          <Item name="<AuthorByline>" usage="The 'by user' assembly: detail-page subtitles, map panel header, detail body Author row. size=xs for the dense panel; prefix=false when the slot's label already says Author; avatar leads with the profile picture on the detail-page signature slots. coAuthors credits more analysts after the lead (the geolocators an event shares, from creditProps), each as its picture and name side by side, with no visible separator; a screen reader hears ana, bo and cy. coAuthorsAs=avatars keeps the lead as picture and name and shows the co-authors as an <AvatarStack> (sm on a page, xs on a card), each picture linked, named by its handle and showing it in a tooltip: the feed and list cards and the event page header. BYLINE_GAP is the one gap of a credit line, which the event form's managed byline shares, so the read and edit bylines line up. link=false drops the anchor for a slot that is already one click (a version-history row under its stretched link), where a nested link is a target the mouse and the keyboard disagree about. A name with its own href links there instead of a profile: organizationByline turns an organization into one (its picture, its name, its page), as on an organization's approval and an approval request to it.">
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
            <Variant label="coAuthors (shared credit)">
              <span className="text-sm text-neutral-400">
                <AuthorByline
                  author={MOCK_DETAIL.owner}
                  coAuthors={[{ username: "bo" }, { username: "cy" }]}
                  avatar
                />
              </span>
            </Variant>
            <Variant label='coAuthorsAs="avatars" (feed cards, event header)'>
              <span className="text-sm text-neutral-400">
                <AuthorByline
                  author={MOCK_DETAIL.owner}
                  coAuthors={[{ username: "bo" }, { username: "cy" }]}
                  coAuthorsAs="avatars"
                  avatar
                />
              </span>
            </Variant>
            <Variant label="link={false} (inside a row-wide link)">
              <span className="text-xs text-neutral-400">
                <AuthorByline author={MOCK_DETAIL.owner} prefix={false} link={false} />
              </span>
            </Variant>
            <Variant label="organizationByline (an organization's approval)">
              <span className="text-sm text-neutral-400">
                <AuthorByline
                  author={organizationByline({ slug: "osw", name: "Open Source Watch" })}
                  prefix={false}
                  avatar
                />
              </span>
            </Variant>
          </Item>

          <Item
            name="<OutboundLink>"
            usage="Every link whose href is an absolute http(s) URL renders through it; a raw external <a> anywhere else is a review blocker. The parsed hostname decides the click (lib/outbound.ts, exact host or subdomain, never a substring): Vidit's own domain routes in the app through next/link, a known host (the archives, x.com, t.me, youtube.com, github.com and the few others the app links to by design) opens in a new tab in one click, and any other host opens a centred dialog: MediaOverlay's dialog variant (theme-canvas dim plus blur, focus trapped, Escape and backdrop click close, focus back on the link) around a <Card> with an accent border. The full URL is the only way on, styled as TEXT_LINK, so the reader reads the address to leave; Cancel is the one button and takes the initial focus. Middle and modifier clicks ask too. rel is always noopener noreferrer; ugc adds nofollow ugc for what an analyst wrote (proof bodies, collection descriptions, bios). Paint comes from the caller's className, so a source host, an icon button and a row all keep their look."
          >
            <Variant label="known host: one click">
              <OutboundLink href="https://t.me/some_channel/4242" className={TEXT_LINK}>
                t.me/some_channel/4242
              </OutboundLink>
            </Variant>
            <Variant label="unknown host: click to open the warning dialog">
              <OutboundLink href="https://example.org/analysis/strike-site" ugc className={TEXT_LINK}>
                example.org/analysis/strike-site
              </OutboundLink>
            </Variant>
          </Item>

          <Item name="<SourceLabel>" usage="Source display: the stored URL shortened to its host without a leading www., the full URL in the link's title (the Detected from row, a source block's links), with one italic fallback, no source, for a null URL or a value the parser gives no host for">
            <SourceLabel url="https://t.me/some_channel/4242" variant="inline" />
            <SourceLabel url="https://www.t.me/some_channel/4242/" variant="link" />
            <SourceLabel url={null} variant="inline" />
          </Item>

          <Item
            name="<ArchivedCopies>"
            usage="The archived copy beside each link of a source block, on the event detail surfaces. One copy per link, from whichever service produced it, so the affordance is a single lucide mark: the Archive box, one mark for archiving in every state and for every provider, never the services' own logos. Provider identity lives in the accessible name of the stored copy, never in the shape. It is one ghost icon button in exactly two states, and colour says which: accent where a copy exists and the mark opens it, grey and disabled where none does, for every reader including the event's owner. Recording a copy is an edit, so it happens on the forms through <ArchiveBox> + <ArchiveSnapshotField> and files a version; nothing here writes. The mark carries no `?` of its own: the source_links concept explains it once, so a source with ten links shows one explanation rather than ten. It sits `self-center` because those rows align their text on the baseline, where the square hangs low. Every mark looks alike across the page, so the accessible name carries the state and the target both: linkDescription(source, host, link, total) leads with the source's position, adds the link's position whenever the source holds more than one (two links on one host would otherwise share a name) and falls back to a literal for a URL with no host."
          >
            <Variant label="a stored copy named for the Wayback Machine (a source's one link)">
              <span className="text-sm text-neutral-300">
                t.me
                <ArchivedCopies
                  copy={{
                    url: "https://web.archive.org/web/20260601120000/https://t.me/channel/12345",
                    provider: "wayback",
                    archived_at: "2026-06-01T12:00:00Z",
                  }}
                  describes={linkDescription(0, "t.me", 0, 1)}
                />
              </span>
            </Variant>
            <Variant label="a stored copy named for archive.today, same mark (link 2 of a source)">
              <span className="text-sm text-neutral-300">
                t.me
                <ArchivedCopies
                  copy={{
                    url: "https://archive.ph/abcde",
                    provider: "archive_today",
                    archived_at: "2026-06-01T12:00:00Z",
                  }}
                  describes={linkDescription(0, "t.me", 1, 2)}
                />
              </span>
            </Variant>
            <Variant label="no copy yet: grey and inert, for every reader">
              <span className="text-sm text-neutral-300">
                x.com
                <ArchivedCopies copy={null} describes={linkDescription(1, "x.com", 0, 1)} />
              </span>
            </Variant>
          </Item>

          <Item
            name="<ArchiveBox>"
            usage="One link's archive box on a form, in the link's row after its post time (a <LinkListInput> column). On a form it is never grey: whatever state the link is in there is something to do with it. No copy yet is an icon-only ghost button, the ArchiveRestore mark with an Archive tooltip, which opens the paste line under the row. A copy (the stored one, or a pasted snapshot on an allowed host) shows as itself: the Archive mark and the service's name, opening the copy under the accessible name the event page gives it, with ArchiveRestore beside it, since one link holds one copy and a wrong paste has to be replaceable. On a wide link list the box is 9rem wide in every state, so a copy appearing never narrows the row's other fields; a long service name truncates and its tooltip shows it whole. Every name folds in `describes`, because a form carries several of these and they look alike. Nothing is written here: the paste travels with the form."
          >
            <Variant label="no copy yet: the Archive icon opens the paste line">
              <ArchiveBox
                describes={linkDescription(0, "t.me", 0, 1)}
                snapshot=""
                expanded={false}
                onToggle={() => {}}
              />
            </Variant>
            <Variant label="a copy exists: it opens, and the mark beside it replaces it">
              <ArchiveBox
                describes={linkDescription(0, "t.me", 0, 1)}
                snapshot="https://archive.ph/abcde"
                expanded={false}
                onToggle={() => {}}
              />
            </Variant>
          </Item>

          <Item
            name="<ArchiveSnapshotField>"
            usage="The line <ArchiveBox> opens, across the row of the link it archives: one field and nothing else. No label, no optional marker, no sentence, because the placeholder states the whole contract and names the three archiving services behind SNAPSHOT_HOSTS. The trailing mark opens web.archive.org/save/<link> for the value currently typed above, so archiving a corrected URL is a re-click; it is the one place on a form a mark goes grey, since a link that does not parse has no page to open. isSnapshotUrl / SNAPSHOT_HINT are the client-side check (https + an allowed archive host) and the one sentence explaining it, reused by the forms to refuse a publish before the upload. Under the field, at most one more line: a red refusal for a value that cannot be a snapshot, or an amber WARNING_CALLOUT naming both URLs when the paste reads as a copy of a different link (snapshotArchivesAnotherLink). The warning blocks nothing, which is why its comparison may be loose; the server checks where a snapshot lives, never what it captured. Nothing is written here: the paste travels with the form as the link's `snapshot_url`."
          >
            <div className="w-full max-w-sm space-y-2">
              <Variant label="a link is typed: the door is live">
                <ArchiveSnapshotField
                  link="https://t.me/channel/12345"
                  describes={linkDescription(0, "t.me", 0, 1)}
                  value=""
                  onChange={() => {}}
                />
              </Variant>
              <Variant label="no usable link yet: the door is inert">
                <ArchiveSnapshotField
                  link=""
                  describes={linkDescription(0, "t.me", 0, 1)}
                  value=""
                  onChange={() => {}}
                />
              </Variant>
              <Variant label="a paste that cannot be a snapshot">
                <ArchiveSnapshotField
                  link="https://t.me/channel/12345"
                  describes={linkDescription(0, "t.me", 0, 1)}
                  value="https://example.com/not-an-archive"
                  onChange={() => {}}
                />
              </Variant>
              <Variant label="a snapshot of some other link: a warning, not a refusal">
                <ArchiveSnapshotField
                  link="https://t.me/channel/12345"
                  describes={linkDescription(0, "t.me", 0, 1)}
                  value="https://web.archive.org/web/20260601120000/https://t.me/channel/999"
                  onChange={() => {}}
                />
              </Variant>
              <Variant label="a second link's line">
                <ArchiveSnapshotField
                  link="https://rumble.com/v-mirror"
                  describes={linkDescription(0, "rumble.com", 1, 2)}
                  value=""
                  onChange={() => {}}
                />
              </Variant>
            </div>
          </Item>

          <Item name="<Dot>" usage="The orange notification dot: the rail's identity row, the profile's detections entry, the map filter panel's in-flight pulse. Position / ring / size / colour via className.">
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

          <Item name="<MediaGallery>" usage="The detail-surface media block: geoloc detail + map panel + request detail. variant=page (hero tiles, a lone one at full width, 2-up from two) / panel (stacked thumbnails); grow gives each page tile a 16:9 box at the full width instead of the fixed height (a lone source's file), and a video tile then takes the clip's own aspect ratio, centered, at most 28rem tall and at least 20rem wide; one marked empty box, shown here through the shared TileNotice. A video tile is <VideoPlayer>, whose own bar already covers play, download and the expand control, so a clip carries no floating tile control at all. An image tile is cropped, so the tile itself opens <MediaLightbox> at hero resolution, and its download floats in the corner under HOVER_REVEAL. The card-sized media slot is private to <EntityCard> (its no-media box shows in the detection demo below).">
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

          <Item name="<MediaLightbox>" usage="The one media viewer, mounted by MediaGallery, MediaManager (through FileManager's shared MediaOverlay shell) and a proof body's images, so the viewer can't drift into per-surface copies. MediaOverlay's dialog variant (dimmed, blurred theme canvas, no corner controls, focus on the content's data-overlay-close control) is OutboundLink's warning shell. Backdrop click or Escape closes; the content click is stopped so the player's controls stay usable. Takes either a persisted Media (images view at hero) or a plain {src, kind} for a staged object URL or a proof image. The corner MediaDownloadButton is for images: a clip plays in <VideoPlayer>, whose control bar already carries one. MediaLightboxBody alone renders the sized media for a caller that already owns a shell.">
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

          <Item name="<StatTile> / <StatGrid>" usage="KPI tiles: the profile's Insights row, admin metric grids. `href` turns the whole tile into one click target on the view the figure was read off (TAPPABLE_HOVER plus a focus-visible ring, and the value takes the accent with it); without it the tile is inert paint, which is what a figure with nothing behind it should look like. `small` shrinks the value for a name rather than a count. The first two below are linked, the third is linked and small, the fourth is the inert fallback.">
            <div className="w-full max-w-xl">
              <StatGrid>
                <StatTile icon={MapPin} label="Geolocated" value={42} href="/search?type=event&status=geolocated" />
                <StatTile icon={Bot} label="Detected" value={128} href="/search?type=event&status=detected" />
                <StatTile icon={Swords} label="Top conflict" small value="Russo-Ukrainian War" href="/search?type=event&conflict=Russo-Ukrainian+War" />
                <StatTile icon={Camera} label="Top source kind" small value="None" />
              </StatGrid>
            </div>
          </Item>

          <Item name="<IconTile>" usage="An icon, a title and an optional one-line note in a bordered tile (TILE, with TILE_TITLE on the heading): the chooser on /import, the entry chooser on /submit and the concept rows on /guide. `href` makes the whole tile one next/link with TAPPABLE_HOVER and an accent title on hover; without it the tile is inert. The caller passes the glyph as a node, so a brand mark such as XGlyph fits. `needs` adds a Needs row of neutral Pills at the tile's foot: what the reader needs in hand. `preview` puts a decorative drawing of the result over the title from sm up, and turns the tile into a row below sm, the drawing scaled down to a thumbnail beside the text; in a grid the tiles keep one height and the Needs rows line up. The /submit chooser (SubmitChooser, its drawings built from StatusBadge) uses both. The first tile below is linked, the second is inert, the last two carry a preview and needs.">
            <div className="w-full max-w-3xl space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <IconTile icon={<Archive size={13} strokeWidth={1.8} />} title="Upload your X archive" note="Your whole history, once." href="/import#archive" />
                <IconTile icon={<ClipboardCheck size={13} strokeWidth={1.8} />} title="Request approval" note="Ask an analyst or an organization to approve yours." />
              </div>
              <div className="grid gap-2 sm:auto-rows-fr sm:grid-cols-2 sm:gap-5">
                {SUBMIT_PATHS.slice(0, 2).map((path) => (
                  <IconTile key={path.title} {...path} />
                ))}
              </div>
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

          <Item name="<NumberedSteps>" usage="Static &quot;1, 2, 3…&quot; instruction list: numbered disc + title + body. `plain` on the public guides (/guide, /methodology, /import), where it also numbers the legend under each /guide screenshot, `boxed` with a per-step icon for the archive export walkthrough on /submit. STEP_NUMBER is the plain disc, exported so /import numbers the parts of its annotated post with the same disc its legend uses. Not <ProgressSteps>: this is reference copy the reader works through, every step identical; ProgressSteps renders one running operation's live state (done / active / pending / failed).">
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

          <Item name="<MockPost>" usage="A fake X post in X's own dark card, so a guide can show the shape of a real post instead of describing it (/import teaches what to write and what the bot answers). Illustration only: the &quot;links&quot; are <MockPostLink> spans, never anchors, and the body breaks anywhere so a long one cannot widen its column. MOCK_ANALYST and MOCK_BOT are the shared identities, so the guides read as one person's posts. `media` attaches one placeholder, `quoted` renders the quote card X draws around a quoted post (with its own optional media), `replyingTo` puts a handle in the byline. The body, the quoted text and the media labels take nodes, so /import places STEP_NUMBER markers on the parts it annotates.">
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

          <Item
            name="<LegalLinks>"
            usage="The legal notice and the privacy policy on one muted line, the footer of the landing page and the line under every sign-in and sign-up card, so both stay reachable before an account exists."
          >
            <LegalLinks />
          </Item>

          <Item name="<LinkRow>" usage="Stay in touch and Guides (About), and each row of the Notifications feed (kind and date as the label, the sentence as the value). The profile's linked accounts are icon buttons instead. The trailing ↗ marks external only: an in-app href routes through next/link, a mailto stays a plain <a>, and neither takes the glyph. `leading` (opt-in) shows a node in place of the icon: the feed passes the picture of who is behind the row (an analyst's circle, an organization's square logo), and `icon` stays the fallback when the row has no one behind it. `variant` arrow (opt-in, the feed's rows, the search page's hits and every list on the organization page and the admin Organizations panel): neutral value that wraps, an orange ArrowRight at the right edge, the link stretched over the block (hover and focus light the border and the arrow), and `action` inside the block left of the arrow, above the link; when the value and the action do not fit on one line, the action and the arrow wrap to a second line. `label` is optional. `value` is a node, so the search page's rows mark the words a query matched. `meta` (arrow only) is a muted line under the value (date, version, who, a role or state pill), inside the link, so it never holds a link. `onClick` runs before an in-app href navigates (the search page's coordinates row sets the map view).">
            <div className="w-full max-w-md space-y-2">
              <LinkRow icon={AtSign} label="X / Twitter" value="@vidithq" href="https://x.com/vidithq" />
              <LinkRow icon={BookOpen} label="Getting started" value="/guide" href="/guide" external={false} />
              <LinkRow icon={Mail} label="Email" value="hello@vidit.app" href="mailto:hello@vidit.app" external={false} />
              <LinkRow icon={MessageCircle} label="Discord" value="a-handle (unresolved)" />
              <LinkRow
                icon={UserPlus}
                leading={<Avatar username="maya" size="size-7" decorative />}
                label="New follower · Oct 12"
                value="maya followed you"
                href="/palette"
                external={false}
              />
              <LinkRow
                variant="arrow"
                icon={ClipboardCheck}
                leading={<Avatar username="maya" size="size-7" decorative />}
                label="Approval request · Oct 12"
                value="maya asked you to approve: Strike on the fuel depot north of the river crossing"
                href="/palette"
                external={false}
                action={
                  <RemoveButton label="Dismiss notification" />
                }
              />
              <LinkRow
                variant="arrow"
                icon={MapPin}
                value={
                  <>
                    Strike on the{" "}
                    <mark className="bg-orange-500/30 text-inherit rounded-sm px-0.5">depot</mark>
                  </>
                }
                meta="Geolocated · 9 May 2026 · maya"
                href="/palette"
                external={false}
              />
              <LinkRow
                variant="arrow"
                icon={UserPlus}
                leading={<Avatar username="maya" size="size-7" decorative />}
                value="maya"
                meta={
                  <>
                    <Pill tone="accent">Org manager</Pill>
                    <span>Joined Oct 12</span>
                  </>
                }
                href="/palette"
                external={false}
                action={
                  <>
                    <Button action="role" variant="ghost">Make member</Button>
                    <Button action="delete" variant="danger">Remove</Button>
                  </>
                }
              />
            </div>
          </Item>

          <Item name="<SectionHeading>" usage="Form section heading inside the section's card (a collection's Details, a profile's Bio). An event form's sections take the event page's <SectionEyebrow> above the card instead.">
            <SectionHeading title="Linked accounts" />
          </Item>

          <Item name="<SectionEyebrow>" usage="Detail page + card/panel headings (uppercase eyebrow), and every event form section's heading (Sources, Proof, Location, Details), which sits on the page above the card like the event page's. `invalid` turns it red with FORM_INVALID_LABEL when a publish attempt flags the section.">
            <Variant label="as=h2 (page)">
              <SectionEyebrow title="Details" concept="section_details" />
            </Variant>
            <Variant label="invalid (a form section, flagged)">
              <SectionEyebrow title="Sources" concept="sources" invalid />
            </Variant>
            <Variant label="no concept">
              <SectionEyebrow title="Geolocators" />
            </Variant>
            <Variant label="besideScroller (a row as tall as a HorizontalScroller header)">
              <SectionEyebrow title="Location" concept="section_location" besideScroller />
            </Variant>
          </Item>
        </section>

        {/* Boxes you drop content into, and the pre-data / empty states. */}
        <section className="space-y-3">
          <SectionEyebrow title="Containers & states" />

          <Item name="<Card>" usage="Panels: settings, admin, profile, form sections, each source editor. One rhythm (space-y-4) for all. `aria-label` names a `section` card as a region (Source N). dense is the reading density (p-4) every card of the event page and of an event form takes. CARD_FRAME is the paint (surface, radius, border) Card, DetailCard, the stat tiles and the map panel share.">
            <Card className="w-48">
              <p className="text-xs text-neutral-300">Content</p>
              <p className="text-xs text-neutral-500">Second line</p>
            </Card>
          </Item>

          <Item name="<DetailCard> + <DetailRow> + <DetailPills>" usage="Label / value rows on the event and request detail pages and on each source block. <DetailCard> takes an optional `lead` slot above the rows (a source's file), `leadBeside` to put that slot left of the rows (3:2, LEAD_BESIDE_SPLIT, which a lone source editor shares) once the card is 42rem wide, falling back to the slot on top when narrower, a `header` row above everything (a source block's SourceHeader: a site source's name and its map control), and a `label` that makes it a named region. <DetailRow> takes `wrapLabel`, for a value that holds one line at its full width: the label wraps instead when the row runs short (a source's Capture position). <DetailPills> is a row value made of pills (conflicts, tags), wrapping flush right.">
            <div className="w-full max-w-md space-y-4">
              <DetailCard>
                <DetailRow label="Status" concept="status">
                  <StatusBadge status="geolocated" />
                </DetailRow>
                <DetailRow label="Event date" concept="occurred_date" value="9 May 2026" />
                <DetailRow label="Coordinates" concept="coordinates" value="48.0159, 37.8024" />
              </DetailCard>
              <DetailCard lead={<p className="text-sm text-neutral-500">Lead slot</p>}>
                <DetailRow label="Title" value="Drone footage of the strike" />
                <DetailRow label="Capture position" align="center" wrapLabel>
                  <CoordinateValue lat={48.0201} lng={37.7951} compact />
                </DetailRow>
                <DetailRow label="Tags" align="start">
                  <DetailPills items={[{ id: "t1", name: "armor" }, { id: "t2", name: "night" }]} />
                </DetailRow>
              </DetailCard>
            </div>
            <div className="w-full max-w-3xl">
              <Variant label="leadBeside">
                <DetailCard
                  leadBeside
                  lead={<div className="aspect-video rounded-lg border border-neutral-700 bg-neutral-800" />}
                >
                  <DetailRow label="Title" value="Drone footage of the strike" />
                  <DetailRow label="Captured" value="1 Jun 2026, 09:30 UTC" />
                  <DetailRow label="Tags" align="start">
                    <DetailPills items={[{ id: "t1", name: "armor" }]} />
                  </DetailRow>
                </DetailCard>
              </Variant>
            </div>
          </Item>

          <Item name="<ProofSection>" usage="The proof's card under the Proof eyebrow EventLayout draws, on the event page and every event form: <Card> at p-4, a reading surface. editor frames the form's proof editor (ProofEditor bare, which draws no frame of its own) and takes the field's focus border; invalid adds the red outline a publish attempt sets.">
            <div className="w-full max-w-xl">
              <ProofSection>
                <div className="text-sm text-neutral-300 leading-relaxed">
                  The proof body goes here (rendered HTML, or request notes).
                </div>
              </ProofSection>
            </div>
            <Variant label="editor invalid">
              <div className="w-full max-w-xl">
                <ProofSection editor invalid>
                  <div className="text-sm text-neutral-500">The proof editor sits here.</div>
                </ProofSection>
              </div>
            </Variant>
          </Item>

          <Item name="<EmptyState>" usage="The one empty-state grammar. boxed: empty list pages (requests, search). plain: headline + hint + CTA inside an existing container (detections, recent submissions). invite: dashed first-run hero (feed). One variant per site.">
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
                  lead="Your feed is empty"
                  cta={<Button action="map" variant="primary">Explore the map</Button>}
                >
                  Follow other analysts to see their latest geolocations here.
                </EmptyState>
              </Variant>
            </div>
          </Item>

          <Item name="<PageWithRail>" usage="A main column plus a sticky 17.5rem right rail from lg up. PageShell composes it from its rail prop and widens its column to max-w-6xl, so the main column keeps the 53rem reading width: the filter rail of the feed, the Requests board and search. `header` heads the main column beside the rail rather than above both (PageShell's headerInColumn: the organization page, whose rail opens top right with an invited viewer's answer), and comes first below lg, so a stacked rail lands under the title. The rail sticks at its resting top, so it never moves when the page scrolls, and scrolls on its own once taller than the viewport. Below lg it stacks above the column (narrow=&quot;stacked&quot;), below it (narrow=&quot;below&quot;, for a rail that acts on the column) or leaves the page (narrow=&quot;hidden&quot;, where FilterBar's Filters (N) button opens the same panel full screen; from lg up FilterRail puts the active-filter pills at the rail's head). No rail: one full-width column.">
            <div className="w-full space-y-4">
              <Variant label="rail beside the column">
                <PageWithRail
                  railLabel="Example rail"
                  rail={
                    <Card>
                      <p className="text-xs text-neutral-300">Rail</p>
                    </Card>
                  }
                >
                  <Card>
                    <p className="text-xs text-neutral-300">Main column</p>
                    <p className="text-xs text-neutral-500">Stacks under the rail below lg.</p>
                  </Card>
                </PageWithRail>
              </Variant>
              <Variant label="header in the column">
                <PageWithRail
                  railLabel="Example rail with header"
                  header={<p className="text-sm text-neutral-100">Title and byline</p>}
                  rail={
                    <Card>
                      <p className="text-xs text-neutral-300">Actions, level with the title</p>
                    </Card>
                  }
                >
                  <Card>
                    <p className="text-xs text-neutral-300">Main column</p>
                    <p className="text-xs text-neutral-500">Below lg: title, rail, column.</p>
                  </Card>
                </PageWithRail>
              </Variant>
            </div>
          </Item>

          <Item name="<LoadMoreRow> / <ShowMoreLink>" usage="The one Show more control, a secondary button with one label wherever a list has more. <LoadMoreRow> is the foot of a paged list that grows in place (requests, feed, version history, notifications, an organization's approvals, the admin reports queue and onboarding, the search page's Geolocations group, the create page's matched geolocations, and the detections queue, whose pages are numbered): Show more while a next page exists, a spinner with Loading… while it loads, a failed page's ErrorNotice with its Retry, nothing once the walk ends. `infinite` loads the next page as the row nears the viewport and pauses after a failure until the click. <ShowMoreLink href> is the same control as a link, for a preview whose whole list lives on another page: the profile's geolocations, open requests and collections, each opening its list in search.">
            <div className="w-full space-y-4">
              <Variant label="idle">
                <LoadMoreRow walk={{ hasMore: true, loadingMore: false, loadMore: () => {}, error: null }} />
              </Variant>
              <Variant label="loading">
                <LoadMoreRow walk={{ hasMore: true, loadingMore: true, loadMore: () => {}, error: null }} />
              </Variant>
              <Variant label="failed page">
                <LoadMoreRow
                  walk={{ hasMore: true, loadingMore: false, loadMore: () => {}, error: MOCK_SERVER_FAULT }}
                />
              </Variant>
              <Variant label="link (ShowMoreLink)">
                <div className="flex justify-center">
                  <ShowMoreLink href="/search?type=event&author=ana" />
                </div>
              </Variant>
            </div>
          </Item>

          <Item name="<PageLoading> / <PageError>" usage="Full-screen states before data (detail pages, lists)">
            <p className="text-xs text-neutral-500">
              Full-screen centered states: a quiet{" "}
              <span className="text-neutral-400">Loading…</span>, or an{" "}
              <span className="font-mono">ErrorNotice</span> with its Retry and an optional Back
              to map link. Not rendered here (takes the full height).
            </p>
          </Item>
        </section>

        {/* Full assemblies of the pieces above; the closing list is what can't
            be mocked on a static page. */}
        <section className="space-y-3">
          <SectionEyebrow title="Composed views" />

          <Item name="<EntityCard variant=feed>" usage="Feed: title and status first, then the byline with named dates (`dates`: Event, then Published or Requested) and coordinates, the media, and the key/value tag row (`cardTags`)">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="feed"
                detailHref="/events/demo"
                title={MOCK_CARD_GEO.title}
                badge={<StatusBadge status="geolocated" />}
                author={MOCK_CARD_GEO.owner}
                dates={[
                  { label: "Event", date: MOCK_CARD_GEO.occurred_date },
                  { label: "Published", date: "2026-05-11" },
                ]}
                coords={{ lat: 48.0159, lng: 37.8024 }}
                tags={cardTags({ tags: MOCK_CARD_GEO.tags, conflicts: [] })}
              />
            </div>
          </Item>

          <Item name="<EntityCard variant=compact>: geoloc" usage="Lists (profile recent submissions). coAuthors prints every geolocator the event credits after the owner.">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="compact"
                detailHref="/events/demo"
                title={MOCK_CARD_GEO.title}
                badge={<StatusBadge status="geolocated" />}
                author={MOCK_CARD_GEO.owner}
                coAuthors={[{ username: "bo" }]}
                date={MOCK_CARD_GEO.occurred_date}
                coords={{ lat: 48.0159, lng: 37.8024 }}
                tags={MOCK_CARD_GEO.tags}
              />
            </div>
          </Item>

          <Item name="<EntityCard variant=compact>: linked event" usage="A site page's Linked events: the effect pill as the badge, `place` adds where the event lies against the zone to the meta line, and `actions` holds the event author's controls (change the effect, unlink) above the stretched link.">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="compact"
                detailHref="/events/demo"
                title={MOCK_CARD_GEO.title}
                badge={<Pill tone="danger">Destruction</Pill>}
                author={MOCK_CARD_GEO.owner}
                date={MOCK_CARD_GEO.occurred_date}
                place="3.3 km outside the zone"
                actions={
                  <>
                    <Button icon variant="ghost" aria-label="Change the effect">
                      <SquarePen size={14} />
                    </Button>
                    <RemoveButton label="Unlink from the site" />
                  </>
                }
              />
            </div>
          </Item>

          <Item name="<EntityCard variant=compact>: request" usage="/requests + search results. On /requests, `age` adds how long the request has been open to the meta line, counted from requested_at.">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="compact"
                detailHref="/requests/demo"
                title="Footage wanted near Bakhmut"
                badge={<StatusBadge status="requested" />}
                author={{ username: "analyst" }}
                date="2026-05-01"
                age="Open 12 days"
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
                date={MOCK_DETAIL.occurred_date ?? undefined}
                coords={MOCK_DETAIL.coords}
                tags={MOCK_DETAIL.tags}
              />
            </div>
          </Item>

          <Item name="<EntityCard variant=compact>: a collection item" usage="One item of a collection, on its page's Events list (<CollectionItemCard> with onSelect): the same compact card with three differences the props carry. `author` is omitted, so the row drops its byline, because a collection is one analyst's own set and the page header names them once. onSelect swaps the link for a button that moves the player to the row, and `selected` marks the row it stands on. `uniformHeight={false}` drops the catalogue height floor, since every row here carries the same two lines and the floor would print a band of empty space under each of them: the row stands on its media column and the text centres against it. The write pages show a held item as the same compact row without onSelect and without its tag row: the card links to the event, one line of meta (date, coordinates, the badge), in a vertical list with a <RemoveButton> at each row's right edge.">
            <div className="w-full max-w-xl">
              <EntityCard
                variant="compact"
                title={MOCK_CARD_GEO.title}
                badge={<StatusBadge status="geolocated" />}
                date={MOCK_CARD_GEO.occurred_date}
                coords={{ lat: 48.0159, lng: 37.8024 }}
                tags={MOCK_CARD_GEO.tags}
                uniformHeight={false}
                onSelect={() => {}}
                selected
                selectLabel={`Read this collection from ${MOCK_CARD_GEO.title}`}
              />
            </div>
          </Item>

          <Item name="<CollectionCover>" usage="A collection's mosaic: the 16:9 slot the profile card wears, made of the media of the first few items the collection holds, the way a playlist icon is made of what is on it. Nothing is uploaded and nothing is stored; the collection's own page carries none. Each tile is EntityCard's own MediaThumb slot fed one item's media, so a clip plays as a clip and a collection with nothing to show falls back to the one no-media placeholder rather than to a stand-in of its own. The arrangement is the tile count: one fills the slot, two split it, three put the earliest item tall on the left, four fill a 2x2, with 2px gaps in the card's own neutral. It spans the column it is given, so a caller sizes it by that column.">
            <div className="w-full max-w-xl space-y-3">
              <Variant label="nothing to show">
                <div className="w-56">
                  <CollectionCover cover={[]} />
                </div>
              </Variant>
              <Variant label="one tile">
                <div className="w-56">
                  <CollectionCover cover={MOCK_COVER_TILES.slice(0, 1)} />
                </div>
              </Variant>
              <Variant label="two tiles">
                <div className="w-56">
                  <CollectionCover cover={MOCK_COVER_TILES.slice(0, 2)} />
                </div>
              </Variant>
              <Variant label="three tiles">
                <div className="w-56">
                  <CollectionCover cover={MOCK_COVER_TILES.slice(0, 3)} />
                </div>
              </Variant>
              <Variant label="four tiles">
                <div className="w-56">
                  <CollectionCover cover={MOCK_COVER_TILES} />
                </div>
              </Variant>
            </div>
          </Item>

          <Item name="<DetectionQueueRow>" usage="Detections queue: denser than a card (no byline, coords or tags), whole row clicks through to the edit form. One badge, describing the evidence: 'Ready to review' (outline tone, waiting on a review's judgment, never a complete state), one named missing piece, or a count of several. Hover any badge: every state carries title text saying what it means, which pieces are missing in full, and what to do next.">
            <div className="w-full max-w-xl space-y-2">
              <DetectionQueueRow detection={MOCK_DETECTION_READY} />
              <DetectionQueueRow detection={MOCK_DETECTION_ONE_MISSING} />
              <DetectionQueueRow detection={MOCK_DETECTION_SEVERAL_MISSING} />
            </div>
          </Item>

          <Item name="<EventShell>" usage="The one shell of an event (components/event/EventShell.tsx): the event page and the request page render it through EventReadPage (with EventByline, the byline built from the row), a version page directly, and the edit form and the submit form through EventFormShell (the fields, the form's props and the hidden announcer wired once); each only fills its three zones. Built on PageShell. The title section heads the main column: Back (the real arrow, in the gutter from lg up, in the menu chip below sm), then the title and the byline. On a form the Title field (titleField) takes the title's place, and the page name stays the h1 for assistive tech only. The byline is one line: the owner, the co-geolocators and pending invitees as AvatarStack pictures with their remove discs, then a Popover that holds the account picker; on a published edit it manages the geolocators, on the submit form and a request's or a detection's publish form it picks the co-geolocators the publish invites. Nothing opens in the page, so nothing moves. The actions block is top right: its pinned row stays at the top right while the page scrolls, and what reads below it scrolls with the page (the approvals and an invitation on the event page, a version's approvals, a form's hidden IncompleteFormAnnouncer). The body is EventLayout (components/event/EventLayout.tsx, a PageColumns on the 65:35 PAGE_COLUMNS_SPLIT): Sources and Proof in the main column, Location then Details in the side column. EventLayout draws every section's eyebrow from EVENT_SECTIONS, red on a flagged slot, with the slot's aside beside it, and levels the side column's first eyebrow with the sources row's 32px header. Panels take the full width between the title section and the body (the panels the actions open, a version's banner). The demo renders the real shell inline, inside its own PageFrame, so it follows the window's breakpoints: narrow the window to see the phone order, where the Back arrow moves to the menu chip. Switch the filling to see which slots each surface uses; Open as a page shows the same skeleton at /palette/event-shell.">
            <EventShellPreview />
          </Item>

          <Item name="eventPageSlots / eventPanelContent / <MapPanelBody>" usage="An event's read-only fields, one field set for two surfaces. eventPageSlots fills EventShell's body on the event, version and request pages: the source blocks then the proof in the main column, the location slot (eventLocation, the map and its Coordinates row) then the Details card in the side column. <EventLocation> takes the map as a prop, more rows under the Coordinates row, a coordinatesConcept and footer lines: the site page fills it with the site map, Zone on, Contour and the map legend (SiteLocation), and heads it and its Details card (SiteDetails) with EventSection, EventLayout's own section heading, under the site's ? concepts. eventPanelContent fills the map side panel (MapSidePanel), which a site fills too (sitePanelContent): <MapPanelBody> is its body under the title and byline, one column with the source blocks, the Location block (the Coordinates row), the Details rows, then the footer (an event's proof).">
            <div className="w-full space-y-4">
              <Variant label="eventPageSlots, in EventLayout">
                <EventLayout {...eventPageSlots(MOCK_DETAIL)} />
              </Variant>
              <Variant label="MapPanelBody with eventPanelContent, an imported row with its provenance link">
                <div className="w-[380px] max-w-full space-y-4">
                  <MapPanelBody content={eventPanelContent(MOCK_DETAIL_ARCHIVED)} />
                </div>
              </Variant>
            </div>
          </Item>

          <Item name="<SourceBlock> / <SourceBlocks>" usage="One source of an event on a reading surface (components/sources/SourceBlock.tsx), read like the event's Details card: a <DetailCard> region named Source N, its file in the lead slot through <MediaGallery> (behind its own <GraphicContentGate> when this source is flagged, a No file box without one, and no file area at all on a context source without one), then <DetailRow>s in the order of the editor's fields: Title, Level as a <Pill>, Kind (the kind label, then the file's kind after a middle dot when there is a file: Drone · video, Article; an Unknown kind shows the file's kind alone, or no row without a file), Links (N) (right-aligned, each link through <SourceLabel> (its host, the full URL in the title) followed by its <ArchivedCopies> mark), Posted (its UTC date and time, the date alone at exactly midnight UTC, or Unknown; one line per link, host first, when the links differ), Captured, Capture position (the compact <CoordinateValue>: 4 decimals and the small <CoordinateActions> on one line, under wrapLabel) and Tags as <DetailPills>. A row with no value drops out, Title included. The map panel keeps a LIST_TILE with bare compact rows. `wide` grows the file and sets it beside the rows (<DetailCard leadBeside>). <SourceBlocks> renders the event's blocks in API order: a <SourcesRow> on the event page (eventPageSlots), a lone source taking the whole row as one wide block, and a vertical stack under Sources in the map panel (<MapPanelBody>). <SourcesRow> is the one sources row of the page and every form: a <HorizontalScroller> under a Sources (N) eyebrow, its header holding the arrows from two sources and the caller's actions (a form's Add a source), invalid turning the eyebrow red and note printing why in the header row. <SourceBlocks> takes an `extras` function that gives each block its name, rows after the source's own, actions and className: a site page's sources (siteSourceExtras) add the provider, the note, who filed it, the contour and the map control. A block with `actions` heads its card with SourceHeader, the name and controls row a <SourceEditor> shares.">
            <div className="w-full max-w-2xl">
              <SourceBlocks sources={[MOCK_SOURCE, MOCK_CONTEXT_SOURCE]} alt="Strike on a depot" />
            </div>
            <div className="w-full max-w-4xl">
              <SourceBlocks sources={[MOCK_SOURCE]} alt="Strike on a depot" />
            </div>
          </Item>

          <Item name="<SourceImageryCheck>" usage="The imagery provider check of a satellite or aircraft source (components/sources/). It sits under the links of a <SourceEditor> of kind Satellite or Aircraft, runs POST /sources/check once typing pauses, and names each provider a link opens with its reopening help and its credit. It shows no warning: the source_links and captured_at help say what lets a reader reopen the image.">
            <div className="w-full max-w-md">
              <SourceImageryCheck draft={sourceDraftFrom(MOCK_SATELLITE_SOURCE)} />
            </div>
          </Item>

          <Item name="<HorizontalScroller>" usage="A row of same-width items that scrolls sideways (components/ui/HorizontalScroller.tsx): native overflow scrolling with one snap point per item, so a swipe moves it, focusable so the arrow keys scroll it. A lone item takes the full width, two items fit once the row is 32rem wide, and below that one fits and the next peeks. With more than one item, the header shows the shown range (1 to 2 of 5) and previous and next ghost icon buttons that scroll by one item, without smoothing under prefers-reduced-motion, go inert at the ends, and step on the left and right keys. `actions` adds header controls after the buttons at any item count, and a ref's show(index) scrolls an item into view. The event page's sources and <SourcesField> are its consumers.">
            <div className="w-full max-w-2xl">
              <HorizontalScroller
                heading={<SectionEyebrow margin="none" title="Sources (3)" />}
                label="Sources"
                previousLabel="Previous source"
                nextLabel="Next source"
              >
                {[MOCK_SOURCE, MOCK_CONTEXT_SOURCE, MOCK_SOURCE].map((source, index) => (
                  <SourceBlock key={index} source={source} index={index} alt="Strike on a depot" />
                ))}
              </HorizontalScroller>
            </div>
          </Item>

          <Item name="<SourcesField> / <SourceEditor>" usage="The Sources section of every event form (components/sources/): one <SourceEditor> per source, each a <Card>, in the order of the event page's source block: the file slot (MediaManager on <FileManager>, one full-width tile; a pick uploads at once through POST /uploads; on a form that edits a stored event, while no direct or indirect source has a file, an empty direct or indirect slot holds Use a proof image, a ghost <Button> that copies a stored proof image into it through POST /uploads/from-proof, with a <Select> under the slot to pick another when the proof holds several), the Title (named Source N title), the level (<SegmentedControl>) on its own line and the kind (<Select>, required on every source) under it, the links (<LinkListInput> under Links (N), one row per link with its post time, <ArchiveBox> and, on an X, Telegram or TikTok post link while the source has no file, a ghost icon button that imports the link's file through POST /uploads/from-link (a post with several files gets a <Select> under the slot to pick one), Add a link under them, then <SourceImageryCheck> on a satellite or aircraft source), then Capture details (<Disclosure>, open when a field inside holds a value): Captured (<DateTimeInput>, UTC), the capture position (CoordinateInputs, hidden for an article, an official statement or another document), the tags (<TagChips>) and Graphic content (<Switch> with its ?, locked on a flagged stored source). Each label's ? sits beside its <label>, never inside it. The section has no card of its own: its Sources (N) <SectionEyebrow> header row sits on the page like the event page's, and a missing file's red line sits in that row, so no editor moves down. It lays the editors out in a row <HorizontalScroller> like the event page's sources, a lone editor at full width with its file beside its title, level and kind once the card is 42rem wide (like <DetailCard leadBeside>), the links and Capture details under both, and two or more side by side with the row's peek, every editor mounted, with Add a source (capped at 10) in its header; Add a source scrolls the new editor into view, the red trash icon (per editor, from two) arms on the first click and removes on the second, then shows the neighbour, and a publish attempt shows the first editor with a gap. `variant` site-source is a site's satellite source (SiteSourceEditor): no level or kind (fixed to context and satellite), a required Captured under the title, and the caller's `extra` (the note) in place of Capture details.">
            <div className="w-full max-w-2xl">
              <SourcesField
                sources={paletteSources}
                setSources={setPaletteSources}
                tags={tpTags}
                setTags={setTpTags}
                suggestedTags={tpTags}
                invalidKeys={new Set()}
              />
            </div>
          </Item>

          <Item name="<PublishActions>" usage="The pinned writes of the event forms (components/geolocations/PublishActions.tsx), the submit form's and the edit form's: an aside named Actions, one right-aligned line of buttons that never wraps, each with a <CountBadge> of what it still misses and dimmed while short (it stays clickable, so a click flags the gaps), its icon from lg up, then the ? and the caller's trailing control (the edit form's red close). usePublishAction runs the caller's checks on every click, then writes at once, or arms on a first click with confirm (the button reads Confirm with ARMED_RING, its sentence in a live region, and the second click writes), or with ask opens a <PopoverPanel> under the button whose own confirm writes (the version note). helpFromSm hides the ? below sm, for a line that fills a 320px phone. The error banner follows the line as an alert; lead heads the block (a review pass's position and Skip). Both forms build their buttons from the same presets and wording: publishGeolocationButton (primary, MapPin, Publishing…), requestWriteButton (secondary, Megaphone), PUBLISH_CONFIRM and REQUEST_CONFIRM for the armed sentences, PUBLISHING_LABEL and SAVING_LABEL for the busy labels. useEventWrite (components/geolocations/useEventWrite.ts) feeds them: one mutation and one gate order per write, and writeGroup reads a form's writes as one banner.">
            <PalettePublishActions />
          </Item>

          <Item name="<ConfirmDialog>" usage="A step that carries input or a final non-destructive choice, never the confirm of a destructive action (that is ConfirmButton, in place): a centred MediaOverlay dialog with a Card, its title, a body saying what the action does, then Cancel (the initial focus, so Enter on open sends nothing) and the primary confirm. Cancel, Escape and a backdrop click close it; the caller owns the request, and `busy` and `error` show it in flight and refused, while `confirmDisabled` holds the confirm until an input the dialog carries is complete. `tone` is accent by default; `danger` paints the border and the confirm red (the danger Button) for a destructive step that needs the dialog: closing an event (the required reason), deleting an organization (the typed slug), and an admin action picked from an ActionMenu, which closes on the pick (purge, soft and hard delete of an analyst, revoke and delete of an invite code). Approve opens it in accent, since an approval is final but destroys nothing, Request approval opens it over the open requests and the picker of whom to ask, and the report flag opens it over the reason and the details.">
            <div className="flex flex-wrap gap-2">
              <Button action="approve" variant="secondary" onClick={() => setConfirmOpen("accent")}>
                Approve
              </Button>
              <Button action="delete" variant="danger" onClick={() => setConfirmOpen("danger")}>
                Delete organization
              </Button>
            </div>
            {confirmOpen === "accent" && (
              <ConfirmDialog
                title="Approve this version?"
                confirmLabel="Approve"
                confirmAction="approve"
                onConfirm={() => setConfirmOpen(null)}
                onCancel={() => setConfirmOpen(null)}
              >
                <p>You approve version 2 of this geolocation.</p>
                <p>An approval is final.</p>
              </ConfirmDialog>
            )}
            {confirmOpen === "danger" && (
              <ConfirmDialog
                title="Delete osw?"
                confirmLabel="Delete organization"
                confirmAction="delete"
                tone="danger"
                onConfirm={() => setConfirmOpen(null)}
                onCancel={() => setConfirmOpen(null)}
              >
                <p>Deleting osw is irreversible. Type the slug to confirm.</p>
              </ConfirmDialog>
            )}
          </Item>

          <Item name="Not rendered (runtime state required)" usage="Genuinely impractical to mock here">
            <ul className="text-[11px] text-neutral-500 space-y-1 list-disc pl-4">
              <li><span className="font-mono text-neutral-400">FileManager / MediaManager</span>: upload, needs real pending files (a source editor above shows a stored file)</li>
              <li><span className="font-mono text-neutral-400">BetaBanner</span>: a {"<Pill tone=\"accent\">"} in a <code>position: fixed</code> wrapper, already visible bottom-right from <code>sm</code> up; below <code>sm</code> the same pill rides the nav drawer via {"<BetaBanner inline>"}</li>
              <li><span className="font-mono text-neutral-400">Sidebar</span>: the primary nav, auth/route-driven, always on screen. Two shapes: a fixed rail on the left edge from <code>sm</code> up (glyphs, or glyphs plus labels once expanded), and below <code>sm</code> a floating chip in the top-left corner that opens the same rail as a drawer over the page</li>
              <li><span className="font-mono text-neutral-400">Sidebar</span> chip and drawer: the rail&apos;s own phone shape, rendered by that component rather than a <code>components/ui/</code> primitive, so there is nothing here to reuse. The chip&apos;s open control is a deliberate one-off too: a 44px neutral thumb target, which {"<Button icon>"} does not offer (36px, accent or red)</li>
              <li><span className="font-mono text-neutral-400">PageShell / PageFrame</span>: page scaffolding, this very page (PAGE_TITLE_TEXT is the title&apos;s type, which a form&apos;s Title field takes in its place): one container on every app page, its left edge at one x and a max-w-6xl column centred on the screen from lg up, 53rem reading width without a rail and max-w-6xl with one (PageShell&apos;s <code>rail</code>); PageShell&apos;s <code>controls</code> slot puts a view&apos;s segmented control under the title, left-aligned (the feed scope, the Requests sort),  PageShell&apos;s <code>titleField</code> puts a form&apos;s Title field in the title&apos;s place and keeps the title as a visually hidden h1 (set by EventShell alone); PageShell&apos;s <code>stickyActions</code> puts the page&apos;s actions at the top right of the header, in the aside named Actions it renders, the header keeping their room, and pins them at the top right of the column once the title scrolls away, on a surface (set by EventShell, the profile and organization edit modes, the collection forms and the search page&apos;s Add to collection); <code>stickyActionsIdle</code> keeps their room but hides them (invisible, inert, no surface) for actions that come and go with a page state, so the header never moves when they return; PageShell&apos;s <code>onBack</code> replaces Back&apos;s history walk (on a /submit path, back to the chooser); PageShell&apos;s <code>column=&quot;wide&quot;</code> gives a page without a rail or a header side the full max-w-6xl column, for a grid that fills it (the /submit chooser&apos;s 3x2 tiles);PageShell&apos;s <code>headerInColumn</code> puts the header (back, title, byline) at the top of the main column beside the rail, so the rail opens top right (the organization page); PageShell&apos;s <code>headerSide</code> lays the header out in <code>PageColumns</code>, a 65:35 main and side column from lg up, its side heading the side column under the sticky actions, and the body continues in <code>EventLayout</code> on the same split (<code>PAGE_COLUMNS_SPLIT</code>) (set by EventShell, see its entry, and by CollectionShell on the collection page and forms); <code>PageColumns</code>&apos; <code>stickySide</code> pins the side column under the sticky actions from lg up while the main column scrolls (CollectionShell); PageShell&apos;s <code>back</code> arrow parks in the gutter left of the title from lg up and sticks there at the top of the viewport while the page scrolls, level with the rail; <span className="font-mono text-neutral-400">PageCenter</span> (from PageFrame) is the one centred full-screen block, on the same rail inset</li>
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
const PALETTE_APPROVERS = [
  { name: "maya", variant: "analyst" },
  { name: "Open Source Watch", variant: "organization" },
  { name: "bo", variant: "analyst" },
  { name: "cy", variant: "analyst" },
  { name: "dee", variant: "analyst" },
  { name: "Sahel Desk", variant: "organization" },
  { name: "eli", variant: "analyst" },
  { name: "fay", variant: "analyst" },
  { name: "gus", variant: "analyst" },
] as const;

function paletteApprovalStamps(approvers: readonly (typeof PALETTE_APPROVERS)[number][]) {
  return approvers.map(({ name, variant }) => ({
    key: name,
    name,
    variant,
    label: name,
    href: "/palette",
  }));
}

const PALETTE_MEDIA: Media = {
  id: "palette-demo",
  role: "source",
  storage_url: "/opengraph-image",
  kind: "image",
  sha256: "0".repeat(64),
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

function PaletteCoordinateInputs() {
  const [lat, setLat] = useState("48.015883");
  const [lng, setLng] = useState("37.802411");
  return (
    <div className="w-full max-w-xs">
      <CoordinateInputs idPrefix="palette_" lat={lat} setLat={setLat} lng={lng} setLng={setLng} />
    </div>
  );
}

function PaletteCopyButton({ variant }: { variant?: "secondary" }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <CopyButton
      label="Copy coordinates"
      announce="Coordinates copied"
      icon={<Copy size={14} />}
      variant={variant}
      copied={copied}
      onClick={() => void copy("48.500000, 37.800000")}
    />
  );
}

function PaletteMediaLightbox() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button action="show" variant="secondary" onClick={() => setOpen(true)}>
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

const PALETTE_ACTIVE_FILTERS: ReadonlyArray<[string, string]> = [
  ["Conflict", "Russo-Ukrainian War"],
  ["Tags", "dashcam"],
  ["Event date", "Until 1 Jan 2025"],
];

function PaletteActiveFilterPills() {
  const [active, setActive] = useState(PALETTE_ACTIVE_FILTERS);
  if (active.length === 0)
    return (
      <button className="text-[11px] text-neutral-500" onClick={() => setActive(PALETTE_ACTIVE_FILTERS)}>
        All removed. Reset the demo
      </button>
    );
  return (
    <ActiveFilterPills
      filters={active.map(([filter, label]) => ({
        key: filter + label,
        filter,
        label,
        onRemove: () => setActive((prev) => prev.filter(([, l]) => l !== label)),
      }))}
      onClearAll={() => setActive([])}
    />
  );
}

const PALETTE_ACCOUNTS: Account[] = [
  { kind: "analyst", username: "ana-demo" },
  { kind: "analyst", username: "bo-demo" },
  { kind: "organization", slug: "open-source-watch", name: "Open Source Watch" },
];

const PALETTE_CITIES = ["Kharkiv", "Kherson", "Kyiv", "Lviv", "Odesa"];

function PaletteCombobox() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const options = PALETTE_CITIES.filter((city) => city.toLowerCase().includes(needle));
  return (
    <div className="w-full max-w-xs space-y-2">
      <Combobox
        aria-label="Pick a city"
        placeholder="Search cities"
        query={query}
        onQueryChange={setQuery}
        open={open}
        onOpenChange={setOpen}
        options={options}
        optionKey={(city) => city}
        renderOption={(city) => city}
        onPick={(city) => {
          setPicked(city);
          setQuery("");
          setOpen(false);
        }}
        status={options.length === 0 ? "No city matches" : null}
      />
      <p className="text-xs text-neutral-500">Picked: {picked ?? "none"}</p>
    </div>
  );
}

function PaletteAccountPicker() {
  const [picked, setPicked] = useState<Account | null>(null);
  return (
    <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
      <Variant label="field resets after a pick">
        <AccountPicker
          aria-label="Pick an account"
          options={PALETTE_ACCOUNTS}
          onSelect={() => undefined}
          placeholder="Search analysts and organizations"
          emptyText="No analyst or organization matches"
        />
      </Variant>
      <Variant label="selected shows as a chip">
        <AccountPicker
          aria-label="Pick an account to keep"
          options={PALETTE_ACCOUNTS}
          selected={picked}
          onSelect={setPicked}
          onClear={() => setPicked(null)}
          placeholder="Pick an analyst"
          emptyText="No analyst or organization matches"
        />
      </Variant>
      <Variant label="inside a narrow card that clips its overflow">
        <Card className="w-56 overflow-hidden">
          <AccountPicker
            aria-label="Pick an account in a card"
            options={PALETTE_ACCOUNTS}
            onSelect={() => undefined}
            placeholder="Search analysts and organizations"
            emptyText="No analyst or organization matches"
          />
        </Card>
      </Variant>
    </div>
  );
}

function PalettePublishActions() {
  const [note, setNote] = useState("");
  const publish = usePublishAction({
    check: () => true,
    write: () => undefined,
    confirm: PUBLISH_CONFIRM,
  });
  const request = usePublishAction({
    check: () => true,
    write: () => undefined,
    confirm: REQUEST_CONFIRM,
  });
  const save = usePublishAction({ check: () => true, write: () => undefined, ask: true });
  return (
    <div className="w-full max-w-md space-y-4">
      <Variant label="two arming publishes, the first short (the submit form)">
        <PublishActions
          disabled={false}
          help="action_submit"
          buttons={[
            publishGeolocationButton(
              { action: publish, busy: false, missing: [{ key: "proof", label: "Proof" }] },
              "Publish geolocation",
            ),
            requestWriteButton({ action: request, busy: false }, "Publish request", PUBLISHING_LABEL),
          ]}
        />
      </Variant>
      <Variant label="a save that asks for a note (a published edit)">
        <PublishActions
          disabled={false}
          buttons={[
            {
              action: save,
              label: "Save version 3",
              busyLabel: SAVING_LABEL,
              busy: false,
              variant: "primary",
              icon: "save",
              ask: {
                label: "Version note",
                content: (
                  <>
                    <Input
                      aria-label="Version note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What changed, and why"
                      autoFocus
                    />
                    <div className="flex justify-end">
                      <Button action="save" variant="primary" onClick={save.confirmAsk}>
                        Save version 3
                      </Button>
                    </div>
                  </>
                ),
              },
            },
          ]}
          trailing={
            <RemoveButton confirms label="Close this geolocation" />
          }
        />
      </Variant>
    </div>
  );
}

function PaletteDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full max-w-sm">
      <Disclosure label="Capture details" open={open} onToggle={() => setOpen((o) => !o)}>
        <div className="space-y-1.5">
          <label htmlFor="palette-disclosure-captured" className={FORM_LABEL}>
            Captured (UTC)
          </label>
          <DateTimeInput
            id="palette-disclosure-captured"
            type="datetime-local"
            value=""
            onChange={() => {}}
          />
        </div>
      </Disclosure>
    </div>
  );
}

function PaletteFilterSection() {
  const [open, setOpen] = useState(true);
  const [kinds, setKinds] = useState<string[]>(["Drone"]);
  const [levels, setLevels] = useState<string[]>([]);
  const toggle = (n: string) => (prev: string[]) =>
    prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n];
  return (
    <div className="w-72 bg-neutral-900 rounded-lg border border-neutral-700 px-3">
      <FilterSection
        title="Source"
        summary={chipSummary([...kinds, ...levels])}
        active={kinds.length + levels.length > 0}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <FieldLabel label="Source kind" />
            <ChipBucket
              options={["Drone", "Dashcam", "Static camera"].map((n) => ({ id: n, name: n }))}
              selected={kinds}
              onToggle={(n) => setKinds(toggle(n))}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel label="Level" />
            <ChipBucket
              options={["Direct", "Indirect"].map((n) => ({ id: n, name: n }))}
              selected={levels}
              onToggle={(n) => setLevels(toggle(n))}
            />
          </div>
        </div>
      </FilterSection>
    </div>
  );
}

function PaletteChipBucket() {
  const [selected, setSelected] = useState<string[]>(["Geolocated", "Sites"]);
  return (
    <div className="w-72 space-y-1.5">
      <FieldLabel label="Show" concept="status" />
      <ChipBucket
        options={["Requested", "Detected", "Geolocated", "Sites"].map((n) => ({ id: n, name: n }))}
        selected={selected}
        onToggle={(n) =>
          setSelected((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]))
        }
      />
    </div>
  );
}

function PaletteChoiceRow() {
  const [value, setValue] = useState<"following" | "everyone" | "nobody">("following");
  return (
    <div className="w-full max-w-lg bg-neutral-900 rounded-lg border border-neutral-700 p-3">
      <ChoiceRow
        label="Accept requests from"
        description="Who can ask you."
        options={[
          { value: "following", label: "People I follow" },
          { value: "everyone", label: "Everyone" },
          { value: "nobody", label: "Nobody" },
        ]}
        value={value}
        onChange={setValue}
      />
    </div>
  );
}

function PaletteFilterSearchFields() {
  const [conflicts, setConflicts] = useState<string[]>(["Russian invasion of Ukraine"]);
  const [tags, setTags] = useState<string[]>([]);
  return (
    <div className="w-72 space-y-4 bg-neutral-900 rounded-lg border border-neutral-700 p-3">
      <ConflictChips
        filter
        conflicts={MOCK_CONFLICTS}
        selected={conflicts}
        setSelected={setConflicts}
      />
      <TagChips filter tags={MOCK_TAGS} selected={tags} setSelected={setTags} />
    </div>
  );
}

function PaletteSwatchPicker() {
  const [value, setValue] = useState("orange");
  return (
    <SwatchPicker
      aria-label="Preview accent color"
      options={[
        { value: "orange", label: "Orange", color: "#f97316" },
        { value: "blue", label: "Blue", color: "#3b82f6" },
        { value: "emerald", label: "Emerald", color: "#10b981" },
        { value: "violet", label: "Violet", color: "#8b5cf6" },
        { value: "rose", label: "Rose", color: "#f43f5e" },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}

function PaletteMapControlButton() {
  const [active, setActive] = useState(false);
  return (
    <MapControlButton
      label="Basemap"
      icon={<MapIcon size={15} />}
      active={active}
      aria-pressed={active}
      onClick={() => setActive((v) => !v)}
    />
  );
}

function PaletteToggleRow() {
  const [on, setOn] = useState(true);
  const [described, setDescribed] = useState(false);
  return (
    <div className="w-72 space-y-3">
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 px-3">
        <ToggleRow label="Hide closed rows" on={on} onToggle={() => setOn((v) => !v)} />
      </div>
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
        <ToggleRow
          label="Also file source 1 on the site"
          description="Satellite source: a site source needs a file and a capture time, and this source lacks one."
          on={false}
          disabled
          onToggle={() => {}}
        />
      </div>
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
        <ToggleRow
          label="Show help tooltips"
          description="The small ? icons that explain each field and section."
          on={described}
          onToggle={() => setDescribed((v) => !v)}
        />
      </div>
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
        <ToggleRow
          label="Relief"
          concept="map_relief"
          variant="setting"
          on={on}
          onToggle={() => setOn((v) => !v)}
        />
      </div>
    </div>
  );
}

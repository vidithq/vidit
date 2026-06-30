# Design principles and decisions

## Philosophy

**Spare by default, complex on demand.**

Legible to first-time visitors; advanced filters reachable on demand. No "dashboard syndrome" or "dark ops" aesthetic.

### Guiding principles

1. **Progressive disclosure**: the default UI is simple: a map, points. Filters, details, and tools appear on demand.
2. **Clarity over aesthetics**: every visual element must serve a function.
3. **Neutral and professional**: sober tone, no "military-tech" or "hacker dashboard" tropes.
4. **Controlled density**: information lives in layers: map → points → detail panel → full proof. The user picks their depth.

## Theme

**Dark minimal.** Uniform dark background, opaque panels, warm accent (orange) for contrast.

Dark for long-session comfort; data reads better on dark.

## Color palette

### Foundation (dark)

| Role | Color | Tailwind | Usage |
|------|-------|----------|-------|
| Background | `#0a0a0a` | `gray-950` | Global background, behind the map |
| Surface | `#171717` | `neutral-900` | Panels, cards, modals |
| Surface elevated | `#262626` | `neutral-800` | Inputs, interactive elements, hover |
| Border | `#333333` | `neutral-700` | Separators, field outlines |
| Text primary | `#f5f5f5` | `neutral-100` | Titles, primary content |
| Text secondary | `#a3a3a3` | `neutral-400` | Labels, metadata |
| Text muted | `#737373` | `neutral-500` | Placeholders, disabled elements |

### Accent

The orange palette uses **tinted-on-dark** variants almost exclusively, and never a flat `bg-orange-500` fill for buttons or selected states. The full recipe is in the [Orange palette recipe](#orange-palette-recipe) below. The shorthand:

| Token | Where it shows up |
|------|-------|
| `orange-400` | Text colour for every interactive element (inline links, button labels, tappable-card hover state, status pills). |
| `orange-500` | The hue itself, which only appears at fractional opacity (`bg-orange-500/10`, `/15`, `/20`) on backgrounds and borders, and full strength on map points + 1.5 px state dots. |

Tag chips are decorative-not-interactive and use a neutral paint (`bg-neutral-800 text-neutral-400`); see the [Orange palette recipe](#orange-palette-recipe) (decorative tag chip).

**The accent hue is selectable.** Orange is the default; Settings → Display also offers blue, emerald, violet, and rose. The choice is browser-local (`localStorage`, key `vidit:palette`), applied as `data-palette` on `<html>`, which remaps the Tailwind `orange-*` scale to the chosen hue (see [`globals.css`](../frontend/src/app/globals.css)). Components keep using the `orange-*` utilities and the [`styles.ts`](../frontend/src/components/ui/styles.ts) constants unchanged: the recipe below holds for whichever hue is active. Map markers can't read CSS variables, so their hex colors live alongside the palette definitions in [`lib/palette.ts`](../frontend/src/lib/palette.ts) and are kept in step there.

### Map points

| Role | Color | Usage |
|------|-------|-------|
| Point default | accent `500` (default `#f97316`) | Submitted points; follows the selected accent palette |
| Point detected | accent `300` (default `#fdba74`) | Machine-detected points; the same hue a shade lighter, so it follows the palette but stays distinct from submitted by lightness |
| Point selected | accent `500` + white border | Active, clicked point |

### Semantic

| Role | Color | Tailwind | Usage |
|------|-------|----------|-------|
| Danger | `#ef4444` | `red-500` | Errors, deletions (`FORM_ERROR_BANNER`) |
| Success / info | accent `500` | `orange-500` | Confirmations + info notices (`FORM_SUCCESS_BANNER`). Orange, not green: a confirmation next to red destructive actions shouldn't read as celebratory. |
| Warning | `#f59e0b` | `amber-500` | Non-blocking caution (`WARNING_CALLOUT`): duplicate probe, curated-tags load failure, tweet-import notice. Colour only; layout at the call site. |

## Orange palette recipe

Vidit's UI lives in a single tonal family: **orange on dark, intensity varies**. The recipes below split the meanings whether something is **interactive**, **selected**, or **decorative**. Every recipe is exported as a named constant from [`frontend/src/components/ui/styles.ts`](../frontend/src/components/ui/styles.ts); use the constant, don't hand-roll the class string (and don't reintroduce the flat `bg-orange-500 text-white` fill, removed in v0.0.10).

The rule that governs all of it:

> If something looks orange and isn't clickable, it's a bug. If something is clickable and isn't orange, it's a bug.

### The five buckets

1. **Inline orange text link** (`TEXT_LINK`): plain clickable accent text in body copy or rows (bylines, source URLs, retry, empty-state CTAs). `text-orange-400 hover:underline`. The neutral counterpart for secondary navigation (Cancel, Back, dismiss) is `MUTED_LINK`, see *Other orange shapes*.
2. **Tappable card / row** (`TAPPABLE_HOVER`): the whole card or row is one click target (GeolocationCard, BountyCard, search rows, profile external links). Neutral at rest; on hover the **border** turns orange and the inner title picks up `group-hover:text-orange-400` (put `group` on the row).
3. **Primary CTA** (`<Button variant="primary">`): "do this now" buttons (Submit, Post a bounty, Geolocate this, Follow, admin actions, the error-boundary "Try again"). Soft-fill outlined orange, visible at rest, brightens on hover. Buttons are the [`<Button>`](../frontend/src/components/ui/Button.tsx) primitive, which bundles shape **and** colour at one uniform size; `buttonClasses("primary")` paints a `<Link>` the same for CTAs that navigate.
4. **Selected / active state** (`FILTER_CHIP_ACTIVE` / `FILTER_CHIP_INACTIVE`): a state indicator on an interactive element (active filter chip, active sidebar nav row, the bounties status filter). Reads as `active ? FILTER_CHIP_ACTIVE : FILTER_CHIP_INACTIVE`. Status pills add a thin border so the badge reads as a discrete shape, in three states: `STATUS_PILL_ACTIVE` (open, orange), `STATUS_PILL_FULFILLED` (end-state, neutral **white**, not green: fulfilment isn't a win), `STATUS_PILL_CLOSED` (author-withdrawn, the quietest, neutral grey).
5. **Decorative tag chip** (`TAG_CHIP`): display-only metadata pills (`bg-neutral-800 text-neutral-400`), rendered as `<span>` not `<button>`. Neutral, so several tags on a card don't compete with the orange CTAs / status pills / links. If a tag is clickable, use bucket ④ instead.

### Other orange shapes

These don't fit the five buckets:

- **`BETA_PILL`**: the fixed closed-beta corner banner + the gate-page header badge. Same family as the status pill but less saturated (decorative, shouldn't compete with active-state pills). `pointer-events-none` is added at the call site.
- **Map points**: drawn on the WebGL canvas, not DOM. The bright full-strength `orange-500` fill is justified by the dot-on-dark-map context: 5-7 px markers, not buttons. See *Components → Map points*.
- **Tiny state dots (1.5 px)**: the map filter loading dot, the sidebar notification dot, the beta indicator dot; all `size-1.5 rounded-full bg-orange-500`.
- **Destructive actions**: the admin "Hard delete" is `<Button variant="danger">` (`bg-red-500 text-white`); sibling soft-delete buttons use `variant="primary"`, so "less destructive = quieter."
- **Navigation chrome + secondary links** (`MUTED_LINK`): back arrows, × close buttons, Cancel / Back / dismiss. Neutral grey (`text-neutral-400 hover:text-neutral-200`) that brightens on hover, so structural chrome and secondary nav don't compete with content links.

### Constants: single source of truth

All of the above export from [`styles.ts`](../frontend/src/components/ui/styles.ts):

| Export | What |
|---|---|
| `FILTER_CHIP_ACTIVE` | Tinted selected state for toggles |
| `FILTER_CHIP_INACTIVE` | Neutral partner of `FILTER_CHIP_ACTIVE` |
| `TAPPABLE_HOVER` | Orange-border-on-hover for tappable cards/rows |
| `STATUS_PILL_ACTIVE` | Status pill: open / in-progress (orange) |
| `STATUS_PILL_FULFILLED` | Status pill: completed end-state (neutral white) |
| `STATUS_PILL_CLOSED` | Status pill: withdrawn / archived (neutral grey) |
| `BETA_PILL` | Decorative closed-beta / system pill |
| `TAG_CHIP` | Decorative non-clickable tag chip (neutral) |

If you're writing a class string longer than ~3 Tailwind tokens for an orange element, a constant probably already fits.

### What each colour says

| Looks like | Means |
|---|---|
| Plain orange text, underlined on hover | Inline link, click it |
| Card border turns orange on hover | Whole card is clickable |
| Outlined orange button | Primary action |
| Tinted orange background + orange text | Currently selected / active state |
| Neutral grey chip | Decorative tag, not interactive |
| Bright `bg-orange-500` flat fill | Map point or 1.5 px state dot, never a button |
| Bright red filled | Destructive: proceed with caution |
| Neutral grey × or ← | Navigation chrome: close / back |

## Map

- **Style:** CARTO Dark Matter (with labels)
- **URL:** `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`
- **Renderer:** MapLibre GL JS (vector tiles) with globe projection
- Map labels (cities, regions) are discreet light-gray

## Typography

- **Font:** system stack, `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Sizes:**
  - Titles: `text-lg` (18px) max
  - Body: `text-sm` (14px)
  - Labels / meta: `text-xs` (12px)
  - Micro (counters, badges): `text-[11px]`
- **Weights:** `font-medium` for titles, `font-normal` for everything else

## Layout

### Structure

```
┌─────────────────────────────────────────────────┐
│  Top bar (minimal, floating, centered)          │
├──────────┬──────────────────────┬───────────────┤
│  Filters │                     │    Detail      │
│  panel   │       MAP           │    panel       │
│  (left)  │   (full screen)     │    (right)     │
│          │                     │    on click    │
└──────────┴──────────────────────┴───────────────┘
```

- **Map:** full-screen background
- **Top bar:** floating, centered; logo + essential actions only
- **Left panel:** filters, opaque, fixed position
- **Right panel:** event detail, appears on click, dismissible

### Panels

- Background: `neutral-900` opaque (no glass / blur)
- Border: `border neutral-700`
- Corners: `rounded-lg` (8px)
- Padding: `p-4`
- Floating above the map (no full-height sidebar)
- Width: ~240px (filters), ~380px (detail)

## Components

### Build on shared primitives

Every element below is a reusable primitive. Compose from them; do not hand-roll a one-off. If no primitive fits a new need, the missing piece is added to [`components/ui/`](../frontend/src/components/ui) (or as a new `FORM_*` / `styles.ts` constant) and consumed from there, never inlined in a page or feature component. Growing the vocabulary with a new shared component is a maintainer decision (see [`AGENTS.md`](../AGENTS.md) → *Conventions*); reusing or extending an existing one is the default.

### Links and clickable surfaces

Orange = clickable; see the [Orange palette recipe](#orange-palette-recipe) for the five buckets and constants. Carve-outs: navigation chrome stays neutral grey, destructive actions go red. External links open in a new tab (`target="_blank" rel="noopener noreferrer"`) with the same orange styling.

### Map points

- Default radius: 6px
- Selected radius: 7px + 2px white border
- Color: `orange-500` (`#f97316`)
- Opacity: 1.0 (individual points), 0.85 (clusters)
- Pointer cursor on hover

### Filters

- Labels: `text-[10px] uppercase tracking-wider text-neutral-500`
- Inputs: `bg-neutral-800 border-neutral-700 text-neutral-300`
- Focus: `border-orange-500`
- Active filter tags/buttons: `FILTER_CHIP_ACTIVE` (tinted orange; see the [Orange palette recipe](#orange-palette-recipe))
- Inactive filter tags/buttons: `FILTER_CHIP_INACTIVE`
- Point counter at the top of the panel
- "Clear all" button shows up only if filters are active

### Detail panel

- Title: `text-lg font-medium text-neutral-100`
- Metadata: `text-xs text-neutral-400`
- Tags: compact badges via the shared `TAG_CHIP` constant (`bg-neutral-800 text-neutral-400`); see the [Orange palette recipe](#orange-palette-recipe) (decorative tag chip)
- Source link: `text-orange-400 hover:underline`
- Proof: `text-sm text-neutral-300 leading-relaxed`
- Separator border: `border-neutral-800`

### Page chrome

Every main-app page uses the shared [`<PageShell>`](../frontend/src/components/ui/PageShell.tsx) wrapper, which owns the `title` / `subtitle` / `back` slots:

| Element | Style | Notes |
|---|---|---|
| Column | `max-w-4xl mx-auto px-6 pt-10 pb-16 space-y-6` | One width across the app: content, forms, detail, profile, admin. The offset + column (`pl-14` + `max-w-4xl mx-auto px-6`) come from [`<PageFrame>`](../frontend/src/components/ui/PageFrame.tsx), which PageShell composes and the public landing (no title header) uses directly, so both share the same left inset. |
| H1 (`title`) | `text-xl font-medium text-neutral-100` | Page chrome, consistent on every page. |
| Subtitle (`subtitle`) | `text-sm text-neutral-400` | Tight under the H1 (8 px gap). |
| Back arrow (`back`) | `absolute right-full top-1.5 mr-3 text-neutral-400 hover:text-neutral-200` | Lives in the gutter so the title sits at the same column-edge x-coordinate whether back is present or not. |

Loading / error / empty pre-data states use the sibling `<PageCenter>` (`min-h-screen flex items-center justify-center pl-14`). Pages that legitimately opt out: `/` (the public landing) and `/map` (the full-screen map), the `(auth)/*` route group, and `app/error.tsx` (the React Error Boundary lives outside the page tree).

The `(auth)/*` group composes [`<AuthCard>`](../frontend/src/components/auth/AuthCard.tsx) instead: the `max-w-sm` centered dark card owning the optional `icon` / `title` (`text-lg` H1) / `subtitle` / `footer` slots. The two single-email request pages (`/forgot-password`, `/resend-confirmation`) additionally share [`<SingleEmailFlow>`](../frontend/src/components/auth/SingleEmailFlow.tsx), the idle → sending → sent | failed email form; its sent-state copy must stay anti-enumeration ("if X is registered…", never confirming the address exists).

### Buttons

One primitive: [`<Button>`](../frontend/src/components/ui/Button.tsx), shape **and** colour in a single unit at one uniform size (no size scale, by design). Pick the colour with `variant`:

- `primary`: soft-fill outlined orange, the "do this now" CTA.
- `secondary`: transparent outlined orange, quieter alternate action.
- `neutral`: bordered grey, non-accent actions (Cancel, search, Following).
- `danger`: filled red, the one irreversible action (admin hard delete).
- `ghost-accent` / `ghost-danger` / `ghost-neutral`: borderless row actions (admin grant / revoke / soft-delete).

`fullWidth` stretches it (auth submits); orthogonal extras go through `className`. A `<Link>` that should look like a button (a CTA that navigates) takes `buttonClasses(variant)`, so it stays an anchor.

### Forms

**One submit page, two types.** Geolocation and bounty creation share ~80% of their fields, so they're a single page at [`/submit`](../frontend/src/app/submit/page.tsx) with a **Geolocation | Bounty** toggle. The header above the toggle (title `Submit`, subtitle) is **uniform across both modes**; the toggle owns the framing. `/bounties/new` and the old `/geolocations/new` redirect to `/submit` (query-preserving, so `?type=bounty` and `?bounty_id=` survive); "Post bounty" links carry `?type=bounty`. Fulfilling a bounty (`?bounty_id=`) is always a geolocation, so the toggle is hidden and the header swaps to fulfilment instructions.

**Title leads** (it's the detail page's heading), then the sections mirror the detail page's reading order. Geolocation mode runs Title → **Source media** ([`SourceMediaField`](../frontend/src/components/geolocations/SourceMediaField.tsx)) → **Location** ([`LocationPicker`](../frontend/src/components/geolocations/new/LocationPicker.tsx)) → Details ([`DetailsFields`](../frontend/src/components/geolocations/new/DetailsFields.tsx): event date, source post time, source URL) → Tags ([`TagPicker`](../frontend/src/components/ui/TagPicker.tsx)) → Proof ([`ProofEditorPanel`](../frontend/src/components/geolocations/new/ProofEditorPanel.tsx)). **Source media is its own block**: a `SourceMediaField` wrapping the shared [`MediaManager`](../frontend/src/components/geolocations/MediaManager.tsx) (staged thumbnails + add / remove, itself built on the generic [`FileManager`](../frontend/src/components/ui/FileManager.tsx) primitive: drop zone, drag-drop, staged-item + remove chrome, with the caller supplying only how one item renders) reused by the submit and detection-submit forms so the control can't drift, while **Location** ([`LocationPicker`](../frontend/src/components/geolocations/new/LocationPicker.tsx)) holds just the coordinates, the point the footage pins. **Bounty mode** (a bounty is an unfinished geolocation) keeps Source media, drops Location and Proof, and keeps the dates as **optional**, leaving Title → Source media → Details (event date, source post time, source URL) → Tags. Under the toggle a geolocation gets an **import strip** (geolocation-only: a bounty has no coordinates / proof to pre-fill): **Pre-fill from an X post** reveals an inline [`TweetImportBanner`](../frontend/src/components/geolocation/TweetImportBanner.tsx) above the form (title, source, date, media, even coordinates from one post), and **Import your X archive** swaps the bulk on-ramp ([`ImportArchivePanel`](../frontend/src/components/geolocations/ImportArchivePanel.tsx), the same `FileManager` with the archive rendered as a file card) in over the form with the draft preserved behind it, carrying the export guide and bridging to the Detections queue when it lands fresh work. On the geolocation detail page the coordinates render as a Details-style row **fused to the bottom of the Location map** (shared border, no gap); the map side-panel, which renders no Location map, carries the **same section headings as the page** (Source media / Location / Details / Proof, each with its `?`, just denser) with the coordinate row under **Location** (so the side-panel reads like the full page rather than a stripped-down variant). On the detail pages the curated tags render as their own labelled rows (**Conflict** and **Capture source**) with free tags under **Tags**, so they read as structured facts rather than identical chips lost in one row.

Forms are **required by default**: only the exceptions carry an `optional` marker (the event time and free tags on a geolocation; on a bounty the event date, event time, and all tag groups), and no field carries a `required` marker, so the form doesn't read as "only tags are mandatory". Which fields are still missing surfaces on submit (the notice below), not as an up-front note. Section chrome is `bg-neutral-900 rounded-lg border border-neutral-700 p-5` with an `h2` (`text-sm font-medium text-neutral-200`) carrying the section `?`; sections have no always-on subtitle. Labels (`FORM_LABEL`) and the one error banner (`FORM_ERROR_BANNER`) come from [`form-styles.ts`](../frontend/src/components/ui/form-styles.ts); the fields themselves are the [`<Input>`](../frontend/src/components/ui/Input.tsx) component (one field, `variant` = default / compact / locked, with a dimmed `placeholder:text-neutral-600` and the locked variant for bounty-inherited fields). When a create / edit action is blocked for missing required fields, a shared [`IncompleteFormNotice`](../frontend/src/components/ui/IncompleteFormNotice.tsx) lists **every** unmet field at once (not the first miss) directly above the action; it's the same component across geolocation submit, bounty submit, and detection submit (each computes its own required set; the detection-submit floor is a superset of the create-submit's, bounty's a subset). The forms set `noValidate` so this notice, not the browser's one-bubble-at-a-time native validation, owns required-field feedback, and it replays a short entrance each attempt so a repeat click reads as a fresh response. Alongside the list, **each missing field or section is outlined red in place** (`FORM_INVALID_FIELD`) so the reader sees *where* the gaps are, not just that they exist; the misses carry a `key` (from `missing*Fields`) that the shared field bricks highlight off, wired once in `useIncompleteForm`. One content rule rides here: a geolocation's **proof must contain an image** (`proofHasImage`), not just text; it's a source ↔ satellite cross-reference, so an image is the evidence (surfaced as "Proof image"). The detection-submit form carries a single action, **Submit**: a `detected` row is immutable machine output, so submit is the only write to it, applying the whole form and freezing the row as `submitted` in one step (a confirm step precedes it, since the freeze is irreversible).

### Field help (`?`)

[`FieldHelp`](../frontend/src/components/ui/FieldHelp.tsx) puts a `?` (`HelpCircle`) next to a field label, a **section heading**, or a detail row; it reveals a one-line explanation on hover / focus, pinned on click (touch devices don't hover), dismissed by outside-click or Escape (a real `role="tooltip"` in the DOM, not a CSS-only title). It is **neutral grey, not orange** (meta help, not a content action), the one sanctioned exception to "clickable ⇒ orange". Every `?` is `<FieldHelp concept="…" />`, one key, nothing else. The **concept registry** [`lib/fieldHelp.ts`](../frontend/src/lib/fieldHelp.ts) (`FIELD_HELP`) is the single home pairing each concept's tooltip `text` with its accessible `label` (wording mirrors [`data-model.md`](data-model.md)); change a concept there and it updates everywhere, with no per-call-site copy to keep in sync. The **same concepts render on the submit form, the detail page / map panel, and the map filter panel**: source media, location, coordinates, event date, source date, source, conflict, capture source, proof (plus status / "detected from" on detected rows, the detail's own added-date row, and conflict / capture source / source media / event date / added on the filter panel). So what explains a field while you fill it explains it when you read it and when you filter on it, and the surfaces can't drift apart. Vocabulary follows the concept too: the filter that was labelled *Media* is **Source media**, matching the field name everywhere else. The inline pre-fill banner carries its own authorship nudge rather than a `?`. Readers who already know the forms can hide every `?` at once via **Settings → Display**, a per-browser `localStorage` preference ([`helpPreference.ts`](../frontend/src/lib/helpPreference.ts) + [`useHelpHidden`](../frontend/src/hooks/useHelpHidden.ts)). The `?` is the single source of section help (sections carry no always-on subtitle), so with help hidden the form is just labels and fields (the intended power-user view).

### Status dots and badges

- Sidebar nav items carry an optional `notify` flag: an orange dot at the icon corner for "new content awaits" (static today).
- For inline placeholders next to author handles or in panel headers, prefer a dedicated atom like [`profile/TrustBadge.tsx`](../frontend/src/components/profile/TrustBadge.tsx).

## What we avoid

- Heavy glow, neon, pulse effects
- Gradients
- Glass / blur
- Decorative icons
- Long or showy animations
- Too many distinct colors; orange is the single accent
- Information overload on the default view

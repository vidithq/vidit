# Design — principles and decisions

## Philosophy

**Spare by default, complex on demand.**

Legible to first-time visitors; advanced filters reachable on demand. No "dashboard syndrome" or "dark ops" aesthetic.

### Guiding principles

1. **Progressive disclosure** — the default UI is simple: a map, points. Filters, details, and tools appear on demand.
2. **Clarity over aesthetics** — every visual element must serve a function.
3. **Neutral and professional** — sober tone, no "military-tech" or "hacker dashboard" tropes.
4. **Controlled density** — information lives in layers: map → points → detail panel → full proof. The user picks their depth.

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

The orange palette uses **tinted-on-dark** variants almost exclusively — never a flat `bg-orange-500` fill for buttons or selected states. The full recipe is in the [Orange palette recipe](#orange-palette-recipe) below. The shorthand:

| Token | Where it shows up |
|------|-------|
| `orange-400` | Text colour for every interactive element (inline links, button labels, tappable-card hover state, status pills). |
| `orange-500` | The hue itself — only appears at fractional opacity (`bg-orange-500/10`, `/15`, `/20`) on backgrounds and borders, and full strength on map points + 1.5 px state dots. |

Tag chips are decorative-not-interactive and use a neutral paint (`bg-neutral-800 text-neutral-400`) — see the [Orange palette recipe](#orange-palette-recipe) (decorative tag chip).

### Map points

| Role | Color | Usage |
|------|-------|-------|
| Point default | `#f97316` / `orange-500` | All points, single color |
| Point selected | `#f97316` + white border | Active, clicked point |

### Semantic

| Role | Color | Tailwind | Usage |
|------|-------|----------|-------|
| Danger | `#ef4444` | `red-500` | Errors, deletions |
| Success | `#22c55e` | `green-500` | Confirmations |
| Info | `#3b82f6` | `blue-500` | Hints, neutral links |

## Orange palette recipe

Vidit's UI lives in a single tonal family: **orange on dark, intensity varies**. The recipes below split the meanings whether something is **interactive**, **selected**, or **decorative**. Every recipe is exported as a named constant from [`frontend/src/components/ui/styles.ts`](../frontend/src/components/ui/styles.ts) — use the constant, don't hand-roll the class string (and don't reintroduce the flat `bg-orange-500 text-white` fill, removed in v0.0.10).

The rule that governs all of it:

> If something looks orange and isn't clickable, it's a bug. If something is clickable and isn't orange, it's a bug.

### The five buckets

1. **Inline orange text link** — plain clickable text in body copy or rows (bylines, source URLs, "Cancel", "Back to bounties"). `text-orange-400 hover:underline`; sometimes `hover:text-orange-300` when the surrounding row is also turning orange under group-hover.
2. **Tappable card / row** (`TAPPABLE_HOVER`) — the whole card or row is one click target (GeolocationCard, BountyCard, search rows, profile external links). Neutral at rest; on hover the **border** turns orange and the inner title picks up `group-hover:text-orange-400` (put `group` on the row).
3. **Primary CTA** (`PRIMARY_BUTTON`) — "do this now" buttons (Submit, Post a bounty, Geolocate this, Follow, admin actions, the error-boundary "Try again"). Soft-fill outlined orange, visible at rest, brightens on hover. The constant covers colour **only** — shape (padding, width, `disabled:opacity-50`) stays at the call site.
4. **Selected / active state** (`FILTER_CHIP_ACTIVE` / `FILTER_CHIP_INACTIVE`) — a state indicator on an interactive element (active filter chip, active sidebar nav row, the bounties status filter). Reads as `active ? FILTER_CHIP_ACTIVE : FILTER_CHIP_INACTIVE`. Status pills add a thin border so the badge reads as a discrete shape, in three states: `STATUS_PILL_ACTIVE` (open, orange), `STATUS_PILL_FULFILLED` (end-state, neutral **white** — not green: fulfilment isn't a win), `STATUS_PILL_CLOSED` (author-withdrawn, the quietest — neutral grey).
5. **Decorative tag chip** (`TAG_CHIP`) — display-only metadata pills (`bg-neutral-800 text-neutral-400`), rendered as `<span>` not `<button>`. Neutral, so several tags on a card don't compete with the orange CTAs / status pills / links. If a tag is clickable, use bucket ④ instead.

### Other orange shapes

These don't fit the five buckets:

- **`BETA_PILL`** — the fixed closed-beta corner banner + the gate-page header badge. Same family as the status pill but less saturated (decorative, shouldn't compete with active-state pills). `pointer-events-none` is added at the call site.
- **Map points** — drawn on the WebGL canvas, not DOM. The bright full-strength `orange-500` fill is justified by the dot-on-dark-map context: 5–7 px markers, not buttons. See *Components → Map points*.
- **Tiny state dots (1.5 px)** — the map filter loading dot, the sidebar notification dot, the beta indicator dot; all `size-1.5 rounded-full bg-orange-500`.
- **Destructive actions** — the admin "Hard delete" stays `bg-red-500 text-white`; sibling soft-delete buttons use `PRIMARY_BUTTON`, so "less destructive = quieter."
- **Navigation chrome** (back arrows, × close buttons) — kept neutral grey (`text-neutral-400 hover:text-neutral-200`) so structural chrome doesn't compete with content links.

### Constants — single source of truth

All of the above export from [`styles.ts`](../frontend/src/components/ui/styles.ts):

| Export | What |
|---|---|
| `PRIMARY_BUTTON` | Soft-fill outlined CTA |
| `FILTER_CHIP_ACTIVE` | Tinted selected state for toggles |
| `FILTER_CHIP_INACTIVE` | Neutral partner of `FILTER_CHIP_ACTIVE` |
| `TAPPABLE_HOVER` | Orange-border-on-hover for tappable cards/rows |
| `STATUS_PILL_ACTIVE` | Status pill — open / in-progress (orange) |
| `STATUS_PILL_FULFILLED` | Status pill — completed end-state (neutral white) |
| `STATUS_PILL_CLOSED` | Status pill — withdrawn / archived (neutral grey) |
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
| Bright `bg-orange-500` flat fill | Map point or 1.5 px state dot — never a button |
| Bright red filled | Destructive — proceed with caution |
| Neutral grey × or ← | Navigation chrome — close / back |

## Map

- **Style:** CARTO Dark Matter (with labels)
- **URL:** `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`
- **Renderer:** MapLibre GL JS (vector tiles) with globe projection
- Map labels (cities, regions) are discreet light-gray

## Typography

- **Font:** system stack — `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
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
- **Top bar:** floating, centered — logo + essential actions only
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
- Active filter tags/buttons: `FILTER_CHIP_ACTIVE` (tinted orange — see the [Orange palette recipe](#orange-palette-recipe))
- Inactive filter tags/buttons: `FILTER_CHIP_INACTIVE`
- Point counter at the top of the panel
- "Clear all" button shows up only if filters are active

### Detail panel

- Title: `text-lg font-medium text-neutral-100`
- Metadata: `text-xs text-neutral-400`
- Tags: compact badges via the shared `TAG_CHIP` constant (`bg-neutral-800 text-neutral-400`) — see the [Orange palette recipe](#orange-palette-recipe) (decorative tag chip)
- Source link: `text-orange-400 hover:underline`
- Proof: `text-sm text-neutral-300 leading-relaxed`
- Separator border: `border-neutral-800`

### Page chrome

Every main-app page uses the shared [`<PageShell>`](../frontend/src/components/ui/PageShell.tsx) wrapper, which owns the `title` / `subtitle` / `back` slots:

| Element | Style | Notes |
|---|---|---|
| Column | `max-w-4xl mx-auto px-6 pt-10 pb-16 space-y-6` | One width across the app — content, forms, detail, profile, admin. |
| H1 (`title`) | `text-xl font-medium text-neutral-100` | Page chrome, consistent on every page. |
| Subtitle (`subtitle`) | `text-sm text-neutral-400` | Tight under the H1 (8 px gap). |
| Back arrow (`back`) | `absolute right-full top-1.5 mr-3 text-neutral-400 hover:text-neutral-200` | Lives in the gutter so the title sits at the same column-edge x-coordinate whether back is present or not. |

Loading / error / empty pre-data states use the sibling `<PageCenter>` (`min-h-screen flex items-center justify-center pl-14`). Pages that legitimately opt out: `/` (the public landing) and `/map` (the full-screen map), the `(auth)/*` route group, and `app/error.tsx` (the React Error Boundary lives outside the page tree).

The `(auth)/*` group composes [`<AuthCard>`](../frontend/src/components/auth/AuthCard.tsx) instead — the `max-w-sm` centered dark card owning the optional `icon` / `title` (`text-lg` H1) / `subtitle` / `footer` slots. The two single-email request pages (`/forgot-password`, `/resend-confirmation`) additionally share [`<SingleEmailFlow>`](../frontend/src/components/auth/SingleEmailFlow.tsx), the idle → sending → sent | failed email form; its sent-state copy must stay anti-enumeration ("if X is registered…", never confirming the address exists).

### Buttons

- **Primary CTA:** `PRIMARY_BUTTON` constant — soft-fill outlined orange. See the [Orange palette recipe](#orange-palette-recipe).
- **Secondary:** `bg-neutral-800 border border-neutral-700 text-neutral-300` — secondary actions.
- **Ghost:** `text-neutral-500 hover:text-neutral-300` — tertiary actions (close, clear).
- Compact size: `px-3 py-1.5 text-sm rounded-md`.

### Forms

**One submit page, two types.** Geolocation and bounty creation share ~80% of their fields, so they're a single page at [`/submit`](../frontend/src/app/submit/page.tsx) with a **Geolocation | Bounty** toggle. The header above the toggle (title `Submit`, subtitle) is **uniform across both modes** — the toggle owns the framing. `/bounties/new` and the old `/geolocations/new` redirect to `/submit` (query-preserving, so `?type=bounty` and `?bounty_id=` survive); "Post bounty" links carry `?type=bounty`. Fulfilling a bounty (`?bounty_id=`) is always a geolocation, so the toggle is hidden and the header swaps to fulfilment instructions.

**Title leads** (it's the detail page's heading), then the sections mirror the detail page's reading order. Geolocation mode runs Title → **Location** ([`LocationPicker`](../frontend/src/components/geolocations/new/LocationPicker.tsx)) → Details ([`DetailsFields`](../frontend/src/components/geolocations/new/DetailsFields.tsx): event date, source date, source URL) → Tags ([`TagPicker`](../frontend/src/components/ui/TagPicker.tsx)) → Proof ([`ProofEditorPanel`](../frontend/src/components/geolocations/new/ProofEditorPanel.tsx)). The **Location** block ([`LocationPicker`](../frontend/src/components/geolocations/new/LocationPicker.tsx)) is one reused component in both modes: the source media ([`EvidenceUploader`](../frontend/src/components/geolocations/new/EvidenceUploader.tsx), labelled *Source media*) plus, for a geolocation, the coordinates — the footage and the point it pins, together. **Bounty mode** (a bounty is an unfinished geolocation) reuses the same **Location** block with the coordinates dropped (just the source media), drops Proof, and keeps the dates as **optional**, leaving Title → Location (source media) → Details (event date, source date, source URL) → Tags. The tweet import is an `Import from tweet` button **mirrored to the right of the toggle** at the same height (geolocation only — a bounty has no coordinates / proof to pre-fill); it opens a [`Modal`](../frontend/src/components/ui/Modal.tsx), not a field, so it can't be mistaken for one and its no-X-link nudge lives in the dialog. On the geolocation detail page the coordinates render as a Details-style row **fused to the bottom of the Location map** (shared border, no gap); the map side-panel, which renders no Location map, **leads its rows with the coordinate row** so they stay prominent there too. On the detail pages the curated tags render as their own labelled rows — **Conflict** and **Capture source** — with free tags under **Tags**, so they read as structured facts rather than identical chips lost in one row.

Forms are **required by default**: a one-line "required unless marked optional" note sits at the top, and only the exceptions carry an `optional` marker — the source date and free tags on a geolocation; on a bounty the event date, source date, and all tag groups. No `required` markers, so the form doesn't read as "only tags are mandatory". Section chrome is `bg-neutral-900 rounded-lg border border-neutral-700 p-5` with an `h2` (`text-sm font-medium text-neutral-200`) carrying the section `?`; sections have no always-on subtitle. Labels (`FORM_LABEL`), inputs (`FORM_INPUT`, with a dimmed `placeholder:text-neutral-600`), bounty-inherited locked inputs (`FORM_INPUT_LOCKED`), and the error banner (`FORM_ERROR_BANNER`) come from [`form-styles.ts`](../frontend/src/components/ui/form-styles.ts).

### Field help (`?`)

[`FieldHelp`](../frontend/src/components/ui/FieldHelp.tsx) puts a `?` (`HelpCircle`) next to a field label, a **section heading**, or a detail row; it reveals a one-line explanation on hover / focus, pinned on click (touch devices don't hover), dismissed by outside-click or Escape (a real `role="tooltip"` in the DOM, not a CSS-only title). It is **neutral grey, not orange** — meta help, not a content action — the one sanctioned exception to "clickable ⇒ orange". Every `?` is `<FieldHelp concept="…" />` — one key, nothing else. The **concept registry** [`lib/fieldHelp.ts`](../frontend/src/lib/fieldHelp.ts) (`FIELD_HELP`) is the single home pairing each concept's tooltip `text` with its accessible `label` (wording mirrors [`data-model.md`](data-model.md)); change a concept there and it updates everywhere, with no per-call-site copy to keep in sync. The **same concepts render on the submit form and on the detail page / map panel** — source media, location, coordinates, event date, source date, source, conflict, capture source, proof (plus status / "detected from" on detected rows) — so what explains a field while you fill it explains it when others read it, and the two surfaces can't drift apart. The tweet-import modal explains itself in its own subtitle rather than a `?`. Readers who already know the forms can hide every `?` at once via **Settings → Display** — a per-browser `localStorage` preference ([`helpPreference.ts`](../frontend/src/lib/helpPreference.ts) + [`useHelpHidden`](../frontend/src/hooks/useHelpHidden.ts)). The `?` is the single source of section help — sections carry no always-on subtitle — so with help hidden the form is just labels and fields (the intended power-user view).

### Work-in-progress affordances

For features visible to testers but not yet built:

- [`WipBadge`](../frontend/src/components/ui/WipBadge.tsx) — small white-on-dark pill, default text `Coming soon`. Pass `children` to override (the sidebar nav uses `Soon` for compactness).
- Sidebar nav items opt into a `wip` flag (`Soon` pill in expanded mode) and a separate `notify` flag (orange dot in collapsed mode for "new content awaits").
- For inline placeholders next to author handles or in panel headers, prefer a dedicated atom like [`profile/TrustBadge.tsx`](../frontend/src/components/profile/TrustBadge.tsx).

## What we avoid

- Heavy glow, neon, pulse effects
- Gradients
- Glass / blur
- Decorative icons
- Long or showy animations
- Too many distinct colors — orange is the single accent
- Information overload on the default view

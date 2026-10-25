# Design principles and decisions

Every surface composes the same primitives, and two reader preferences repaint all of them at once. This page is that vocabulary: the principles the interface follows, the palette and layout it draws from, and the components a page is allowed to use.

```mermaid
flowchart LR
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`a surface, or a consumer that reads no CSS`"]:::spec
    l2["`a shared primitive or constant`"]:::shared
    l3["`the one place a rule is written`"]:::core
    l1 ~~~ l2 ~~~ l3
  end

  subgraph pref [What a reader picks]
    direction TB
    settings["`**Settings → Display**
    theme and accent hue, saved to the account`"]:::spec
    attr["`**attributePreference.ts**
    caches the choice and stamps data-theme and data-palette on &lt;html&gt;`"]:::core
    globals["`**globals.css**
    remaps the neutral-* and orange-* Tailwind scales; components keep writing the same utilities`"]:::core
    settings --> attr --> globals
  end

  canvas["`**lib/palette.ts**, **Map.tsx**
  map markers and the basemap carry hex, since a canvas reads no CSS variable`"]:::spec

  subgraph build [What a page is built from]
    direction TB
    frame["`**PageFrame**
    the rail inset and the one column width`"]:::shared
    shell["`**PageShell**
    title, subtitle, back, actions`"]:::shared
    prims["`**components/ui/**
    Button, Pill, Input, Card, EntityCard, MediaGallery, Avatar, FieldHelp, OutboundLink`"]:::shared
    consts["`**form-styles.ts**, **styles.ts**
    FORM_*, ACCENT_SURFACE, TAPPABLE_HOVER, TEXT_LINK, WARNING_CALLOUT`"]:::shared
    frame --> shell
    consts --> prims
  end

  page["`**a page or feature component**
  composes primitives; a control defined inline is a review-blocker`"]:::spec
  catalogue["`**/palette**
  the live catalogue; the hygiene job fails when a primitive or constant is missing from it`"]:::core

  globals --> prims
  globals --> consts
  attr --> canvas
  shell --> page
  prims --> page
  consts --> page
  prims --> catalogue
  consts --> catalogue
```

Each region of the diagram has a section below. What a reader picks is [Theme](#theme) and the [accent](#accent). What a page is built from is [Components](#components), whose class constants are named in the [accent recipe](#accent-recipe) and whose frame is [Page chrome](#page-chrome). `/palette` is the gate on that vocabulary, and the exceptions decided once are [Sanctioned one-offs](#sanctioned-one-offs).

## Philosophy

The interface is spare by default and reveals complexity on demand. It stays legible to first-time visitors, and advanced filters and tools appear only when needed. The design avoids a cluttered dashboard look and a dark-ops aesthetic.

1. **Progressive disclosure**: the default view is a map and points. Filters, detail, and tools appear on demand.
2. **Clarity over aesthetics**: every visual element serves a function.
3. **Neutral and professional**: the tone is sober, with no military-tech or hacker-dashboard tropes.
4. **Controlled density**: the reader moves from map, to points, to detail panel, to full proof, and picks the depth.

## Theme

The interface is dark by default, with light available on demand. It uses a uniform background, opaque panels, and one warm accent for contrast. Dark reads better for long, data-dense sessions and stays the default. Light is a second option for readers who want it.

Theme and accent share one mechanism, [`attributePreference.ts`](../frontend/src/lib/attributePreference.ts): it caches the choice in `localStorage`, stamps a data attribute on `<html>`, and [`globals.css`](../frontend/src/app/globals.css) remaps a Tailwind scale under that attribute, so every utility repaints with no per-component change. Two consumers read no CSS variable and carry hex instead: [`Map.tsx`](../frontend/src/components/map/Map.tsx) swaps the basemap on [`useTheme`](../frontend/src/hooks/useTheme.ts), and map markers read [`lib/palette.ts`](../frontend/src/lib/palette.ts).

Both preferences, and the help tooltip switch, are saved to the account through [`PATCH /users/me/preferences`](api.md#patch-usersmepreferences), so they follow a signed-in analyst across devices. [`lib/preferences.ts`](../frontend/src/lib/preferences.ts) holds the two directions. A change in Settings applies locally at once and writes through to the server. After sign-in, and on each load with a session, each preference is reconciled on its own. A value the account has saved wins and rewrites `localStorage`. Where the account has saved none, the value this browser saved for the same account is written to the account instead, so a choice made before the account stored it is kept. The cache records which account it belongs to: signing out clears it, and a sync for another account clears it before applying that account's values, so one analyst's choices never reach another account on a shared browser. A cache that carries no account, written before the cache recorded one, is adopted by the first account that syncs. `localStorage` stays the first-paint cache: the inline script in the root layout reads it before React runs, so a device that has never seen the account paints the defaults until the preferences load.

The theme is independent of the accent hue. Its key is `vidit:theme`, and light applies as `data-theme="light"`; dark is the default and carries no attribute. Light remaps the `neutral-*` scale to a curated soft ramp, plus the semantic `red` / `amber` scales, mirrored so their pale text stops go dark on the light tint. The block also sets `color-scheme`, so native widgets (scrollbars, date and select popups) track the theme. The accent is not theme-adjusted, except that accent text (links, the success banner) reads a touch lighter in light mode. The basemap swaps CARTO Dark Matter for its light counterpart, Positron.

## Colour palette

### Foundation

The dark roles below are the default. The light theme re-points the same `neutral-*` scale to a curated soft ramp (`globals.css`): a soft warm grey canvas (`neutral-950`) with warm off-white cards (`neutral-900`) floating on it, and dark grey text (`neutral-100` = `#232323`, not black). This keeps a large light surface easy on the eyes instead of a flat, near-white glare. The light surfaces carry a faint warmth (`R > G > B`), while the text greys stay neutral. This mirrors how the dark scale avoids pure black and pure white.

| Role | Color | Tailwind | Usage |
|------|-------|----------|-------|
| Background | `#0a0a0a` | `neutral-950` | Global background, behind the map |
| Surface | `#171717` | `neutral-900` | Panels, cards, modals |
| Surface elevated | `#262626` | `neutral-800` | Inputs, interactive elements, hover |
| Border | `#404040` | `neutral-700` | Separators, field outlines |
| Text primary | `#f5f5f5` | `neutral-100` | Titles, primary content |
| Text secondary | `#a3a3a3` | `neutral-400` | Labels, metadata |
| Text muted | `#737373` | `neutral-500` | Placeholders, disabled elements |

### Accent

There is one accent hue. It's selectable, and orange by default. Settings → Display also offers blue, emerald, violet, and rose. Its key is `vidit:palette`, and `data-palette` remaps the `orange-*` scale to the chosen hue (see [Theme](#theme)). Components keep writing `orange-*` utilities and the [`styles.ts`](../frontend/src/components/ui/styles.ts) constants, so everything below holds for whichever hue is active.

The accent is **tinted-on-dark**, never a flat `bg-orange-500` fill for buttons or selected states:

| Token | Where it shows up |
|------|-------|
| `orange-400` | Text of every interactive element: inline links, button labels, tappable-card hover, status pills. |
| `orange-500` | The hue itself, only at fractional opacity on backgrounds / borders (`bg-orange-500/10`, `/15`, `/20`), and full strength on map points + state dots. |

### Map points

| Role | Color | Usage |
|------|-------|-------|
| Point default | accent `500` (default `#f97316`) | Submitted points; follows the selected accent |
| Point detected | accent `300` (default `#fdba74`) | Machine-detected points; same hue a shade lighter, distinct from submitted by lightness |
| Point selected | accent `500` + white border | Active, clicked point |

### Semantic

| Role | Color | Tailwind | Usage |
|------|-------|----------|-------|
| Danger | `#ef4444` | `red-500` | Errors, deletions (`FORM_ERROR_BANNER`) |
| Success / info | accent `500` | `orange-500` | Confirmations + info notices (`FORM_SUCCESS_BANNER`). Accent, not green: a confirmation next to red destructive actions shouldn't read as celebratory. |
| Warning | `#f59e0b` | `amber-500` | Non-blocking caution (`WARNING_CALLOUT`): duplicate probe, conflicts load failure, tweet-import notice. Colour only; layout at the call site. |

## Accent recipe

Every accent treatment is a named constant from [`styles.ts`](../frontend/src/components/ui/styles.ts) or a primitive. Use it; don't hand-roll the class string. The rule:

> If something carries the accent and isn't clickable, it's a bug. If something is clickable and isn't accent, it's a bug.

Carve-outs: navigation chrome stays neutral grey, destructive actions go red, and the `?` help is neutral (meta, not content). Charts carry one more, and it is the only inert accent on the site: a mark whose accent step encodes a magnitude takes `ACCENT_RAMP` whether or not a reader can act on it, and so does its legend, which is drawn with the same cells as the data it explains. `<SourceHostBar>`'s ranked segments and `<ActivityHeatmap>`'s lit months are both inert ranked marks, so both take the ramp. What stands outside the ranking takes the neutral chart paints instead: an empty month, the unnamed tail, a slice naming no source. External links open in a new tab (`target="_blank" rel="noopener noreferrer"`) with the same accent styling.

There are five buckets:

1. **Inline link** (`TEXT_LINK`): clickable accent text in copy or rows (bylines, source URLs, retry, empty-state CTAs), using `text-orange-400 hover:underline`. An action that only reads like a link (Cancel, dismiss) is a `<Button variant="ghost">`.
2. **Tappable card or row** (`TAPPABLE_HOVER`): the whole card or row is one click target (`EntityCard`, search rows, the About page's link rows). It's neutral at rest. On hover, the border turns accent and the title picks up `group-hover:text-orange-400` (put `group` on the row).
3. **Buttons** (`<Button>`): every action, shape, and colour in one unit at one size. A `<Link>` that must look like a button takes `buttonClasses(variant)`. See the full vocabulary under [Buttons](#buttons).
4. **Pills, chips, and badges** (`<Pill>`): the whole badge family uses one `tone`: `accent` (open, detected, selected), `neutral` (default, tag, closed, inactive), `danger` (error), or `secondary` (an accent outline with no fill, a softer marked state). It's a `<span>` by default; pass `onClick` and it becomes an interactive chip, with the caller driving the tone off its active state. Domain wrappers (`StatusBadge` for the one unified event lifecycle, the invite `StatusChip`) map an enum to tone, icon, and label. A bare tag is `<Pill tone="neutral">` inline, with no wrapper.
5. **Active nav or row surface** (`ACCENT_SURFACE`): the bare accent paint (background and text, no border) for a selected nav row or option (sidebar rows, a `SegmentedControl`'s active option, the accent icon circles on the import panel and detections entry). `<Pill>`'s accent tone composes this paint plus a border, so a pill and an active nav item can't drift apart.

Constants: the pill tones live on `<Pill>` as `PILL_TONE`. [`styles.ts`](../frontend/src/components/ui/styles.ts) exports these paints:

- `ACCENT_SURFACE`, `TAPPABLE_HOVER`, `TEXT_LINK` and `WARNING_CALLOUT` are the colour-only paints above.
- `ACCENT_RAMP` is the five-step accent intensity ramp of the charts. `CHART_TAIL` paints a bucket of real work under no printed name, and `CHART_NEUTRAL` paints absence.
- `META_LINE` is a card's muted meta line: small grey text with its glyphs inline.
- `FLOATING_CONTROL` is the plate behind an icon control that floats over media. `HOVER_REVEAL` hides a control until the pointer or focus reaches its frame, and keeps it visible on touch.
- `ARMED_RING` is the armed half of a two-click confirm.
- `TOOLTIP_SURFACE` is the bubble of an anchored popover.

[`form-styles.ts`](../frontend/src/components/ui/form-styles.ts) exports the form paints: `FORM_LABEL`, `FORM_LABEL_COMPACT` (the denser auth-card label), `FORM_INVALID_FIELD` and `FORM_INVALID_LABEL` (the red state of a field and its label), `FORM_ERROR_BANNER`, `FORM_SUCCESS_BANNER` and `LIST_TILE` (one bordered item of an admin list). If a class string for an accent element runs longer than about 3 Tailwind tokens, look for a constant in these two files first.

## Layout

```
┌────┬─────────────────────────────────────────────┐
│    │  Filters │                    │   Detail    │
│rail│  panel   │        MAP         │   panel     │
│    │  (left)  │   (full screen)    │  on click   │
└────┴─────────────────────────────────────────────┘
```

- **Sidebar rail:** left nav (logo, working surfaces, identity block), a fixed column from `sm` up, which every page clears through `PageFrame`'s `sm:pl-14`. Submit, Requests and Feed show only to a signed-in reader; a signed-out reader gets Map, Search, About and Sign in. Below `sm` it is a drawer behind a floating menu chip and takes no inset at all; see [Phone chrome](#phone-chrome).
- **Map:** full-screen background on `/map`.
- **Left panel:** filters, opaque, floating over the map.
- **Right panel:** event detail, appears on click, dismissible. When the selected event fails to load, the panel shows the error message and a Retry control, never a previously selected event.

**Panels:** `neutral-900` opaque (no glass / blur), `border-neutral-700`, `rounded-lg`, `p-4`, floating above the map. Width 288px (filters), ~380px (detail). Both take a different shape below `sm`; see [Phone chrome](#phone-chrome).

## Typography

- **Font:** Montserrat, loaded through `next/font/google` in [`layout.tsx`](../frontend/src/app/layout.tsx) and set as `--font-sans` in `globals.css`, with `system-ui` as the fallback
- **Sizes:** page titles `text-xl` (20px, the `h1` of `PageShell`); other titles `text-lg` (18px) max; body `text-sm` (14px); labels / meta `text-xs` (12px); micro (counters, badges) `text-[11px]`
- **Weights:** `font-medium` for titles, `font-normal` for everything else

## Map

- **Style:** CARTO Dark Matter (with labels), `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`. The light theme swaps in its matched counterpart, Positron, `.../gl/positron-gl-style/style.json` (see [Theme](#theme)), with a faint `sepia` on the canvas (`globals.css`) that warms Positron's cool grey to match the warm light surfaces.
- **Renderer:** MapLibre GL JS (vector tiles) with globe projection. The zoom floor is 1.8 (`MIN_ZOOM` in [`Map.tsx`](../frontend/src/components/map/Map.tsx)), the lowest level that keeps the globe fully visible without shrinking it away.
- **One map stack.** Every map on the site is the same [`<Map>`](../frontend/src/components/map/Map.tsx): the full-screen canvas, the single pin on an event page, the coverage map a profile opens its work with ([`<ProfileMap>`](../frontend/src/components/profile/ProfileMap.tsx)), and the same map stepped beside the detail panel on a collection page (see [Collections](#collections)). A set with no mappable point renders no card at all, since an empty world map says less than no map and both surfaces carry a list that says the rest. A page whose view comes from its own content passes `fitBounds` (a `MapBounds`, from `pointsBounds` in [`bounds.ts`](../frontend/src/components/map/bounds.ts)) instead of `center` / `zoom`. MapLibre solves the camera against the real container, capped at zoom 9, so a lone point lands on a regional read rather than a street-level one. `pointsBounds` encloses longitude on the shorter arc (the complement of the widest empty gap), so work on either side of the antimeridian frames tight instead of as a world view. A box across the seam comes back unwrapped, with `east` past 180. `MapBounds` is the one bounds shape, for framing and requests alike. The `?bbox=` wire format has one home, [`lib/viewport.ts`](../frontend/src/lib/viewport.ts): its `toBboxParam` rounds outward and widens an unwrapped crossing box to the full longitude range, which is what `parse_bbox` accepts.
- Map labels (cities, regions) are a discreet light grey.
- Point geometry: default radius 6px, selected 7px with a 2px white border. Opacity is 1.0 for points and 0.85 for clusters. The cursor is a pointer on hover.
- **Pin hover preview.** Hovering any single unclustered pin (or a ring dot, described below) shows one shared preview card after a 150 ms hover-intent delay (`PinPreviewCard` in [`Map.tsx`](../frontend/src/components/map/Map.tsx)): title, `StatusBadge`, the fixed `MediaThumb` slot (the picked card thumbnail, or its "no media" box), date, and `AuthorByline`, composed on `Card`. The event detail is fetched only once the hover intent elapses (`GET /events/{id}`, with a bounded in-memory cache that also holds in-flight requests; stale responses are ignored, and a failed fetch shows a terse fallback). The card clamps against the map edges after measuring, and flips to the left of the pin when the right side lacks room, so it always renders fully visible. Ordinary clusters get no preview. A coarse pointer arms no preview at all, so a tap goes straight to the panel; see [Phone chrome](#phone-chrome).
- **Co-located events: counted badge and hover fan-out.** Events sharing one coordinate form a cluster that can never expand. `groupStacks` ([`stack.ts`](../frontend/src/components/map/stack.ts)) groups points client-side on a roughly 1 m epsilon grid with neighbor-cell merging, so a stack straddling a grid line reads as one. Past the clustering ceiling, the group renders as **one counted badge** with the colour, radius, opacity, and count text of a small cluster, so a stack of 3 never reads as a single pin. Cluster counts below the ceiling stay true.
  - Hovering the badge, or an unexpandable cluster (leaves within `STACK_EPSILON` via `getClusterLeaves`), replaces it with `SpiderRing`: 12px DOM dots on an 18px ring around the shared center, the ring growing past about 7 events and capped at 24 dots. A larger stack fans out its first 23 events and fills the last slot with a "+N" marker; the badge count stays the true total.
  - The dots travel out from the center, and back before the badge reappears. Dot colours keep the point semantics (detected shade, selected halo); the badge carries the halo when it holds the selected event.
  - Hovering a dot shows the pin preview, and clicking it opens the event like a normal pin.
  - The ring collapses when the pointer leaves it (with a grace margin), on wheel, or when the map moves. On touch, a tap opens the ring and a tap off it closes it, and the dots carry a wider hit box (see [Phone chrome](#phone-chrome)).
  - Ordinary clusters keep zoom-on-click.
- **Cluster to points crossfade.** The map sets `fadeDuration: 0`, so count labels and their circles swap on the same frame; basemap place labels pop in instead of fading. Count labels skip symbol placement (`text-allow-overlap` + `text-ignore-placement`), so a count is never culled apart from its circle. Around the clustering ceiling, a zoom-interpolated opacity crossfade runs in paint expressions, with stops derived from `CLUSTER_MAX_ZOOM`: clusters and counts thin approaching one zoom past the ceiling, and points and stack badges rise just past it. The crossfade applies **only while a zoom is in flight**; at rest every layer holds full opacity, and a cluster click that resolves past the ceiling lands its pins at full opacity.

## Components

### Build on shared primitives

Every UI element is a reusable primitive. Compose from them; never hand-roll a one-off. If none fits a new need, add the missing piece to [`components/ui/`](../frontend/src/components/ui) (or as a new `FORM_*` / `styles.ts` constant) and consume it from there, never inlined in a page. Growing the vocabulary with a new shared component is a maintainer decision (see [`AGENTS.md`](../AGENTS.md) → *Conventions*). Reusing or extending an existing one is the default.

**Token or component?** A piece is a *component* when it owns shape or behaviour (`<Input>`, `<Pill>`, `<Button>`, `<Card>`). It stays a raw *class constant* when it is a single-element paint composed into someone else's markup (`FORM_LABEL`, `ACCENT_SURFACE`, `TAPPABLE_HOVER`). A constant that starts growing variants has crossed the line, so promote it. Primitives join classes with [`cn`](../frontend/src/lib/cn.ts) (tailwind-merge), so a caller's `className` wins conflicts predictably. `<Button>` and `<Pill>` stay one size by design; the button's only variation is the taller tap shape it takes on a phone (see [Buttons](#buttons)).

The vocabulary:

- **Labels.** `FORM_LABEL` is the uppercase label above a control (`LABEL_TEXT` is the same without `block`). A label's `?` sits beside the `<label>`, never inside it, so a field's accessible name is the label's words alone. [`<FieldLabel>`](../frontend/src/components/ui/FieldLabel.tsx) is that label row: the words (a `<label>` with `htmlFor`, else a `span`), the `?`, then a `trailing` node such as a `<CharCounter>`, red with `invalid`. An event field's name and `?` live in one table, `EVENT_FIELDS` in [`lib/events.ts`](../frontend/src/lib/events.ts) and `SOURCE_FIELDS` in [`lib/sources.ts`](../frontend/src/lib/sources.ts), whose key order is the display order: the page spreads an entry into `<DetailRow>` and the form into `<FieldLabel>`, so a field reads under one name on both. [`<SectionHeading>`](../frontend/src/components/ui/SectionHeading.tsx) heads a form section inside its card (a collection's details, a profile's bio): the title alone. [`<SectionEyebrow>`](../frontend/src/components/ui/SectionEyebrow.tsx) is the uppercase eyebrow over a page, panel, or card section, and over each section of an event form, where `invalid` turns it red.
- **Copy.** The clipboard write and the flash timer are one hook, [`useCopyToClipboard`](../frontend/src/hooks/useCopyToClipboard.ts), and the confirmation is one primitive, [`<CopyButton>`](../frontend/src/components/ui/CopyButton.tsx): an icon button whose mark turns into a check at once and fades back after 1.5 s (no fade under `prefers-reduced-motion`). The accessible name holds still, since a name that changes on click is re-announced as a new control, and the confirmation reaches screen readers through a sibling live region with no visible text. Copy coordinates ([`<CoordinateActions>`](../frontend/src/components/event/CoordinateActions.tsx)), a profile's copied handle and Share where the browser has no share sheet all wear it. `variant="secondary"` boxes the button, for a copy that stands beside a field (Copy coordinates). The admin invite row's text button keeps the hook alone.
- **Small assemblies.**
  - [`<Avatar>`](../frontend/src/components/ui/Avatar.tsx) is the profile-picture circle: the profile header, the user search hits, `<AuthorByline>`'s avatar variant, and the sidebar identity row, which renders it in the rail's 18px glyph box. `size` is the only dimension a caller sets, and the fallback is the handle's initial or a neutral user icon. An `avatar_url` addresses a server-minted object on the media host, uploaded through the profile header's picker (the shared `<FileManager>` in single-file image mode). A failed load falls back to the same circle and a new picture retries, because replacing a picture deletes the old object and a CDN edge can answer for a key before a new one propagates. `iconClassName` colours the icon fallback (the sidebar passes `text-current`, so the glyph follows the row's hover and active state). `decorative` hides the picture from assistive technology where the host names itself, so neither the alt text nor the initial displaces or repeats the name beside it. `shape="square"` rounds the corners instead of the circle, for an organization shown beside analysts.
  - [`<AvatarStack>`](../frontend/src/components/ui/AvatarStack.tsx) is a row of 28px `<Avatar>` pictures: the approval stamps under the event page's actions (see [Event actions and approvals](#event-actions-and-approvals)) and the organization logos in a profile header. `size="sm"` is the 20px picture of a page byline, with a 16px remove disc: `<AuthorByline coAuthorsAs="avatars">` draws the event page's co-geolocators with it and an event form's byline manages them with it, so the two bylines keep one height and one layout. `size="xs"` is the 16px picture of a card's byline. `trailing` follows the last picture on its line, out of the list's items (the approvals' `?`). An item's `variant` picks the circle (`analyst`) or the rounded square (`organization`). Each picture is a link to the item's `href`, named by its `label`, which a `<Tooltip tapToShow>` shows on hover or keyboard focus. On a touch screen the first tap on a picture shows the label and the second tap follows the link. By default the pictures overlap, and a ring in the page colour separates them; set apart, a picture takes the focus ring alone. `spacing="gap"` sets them apart and wraps them onto further lines. `checked` puts a 14px check badge on each picture's bottom-right corner: a disc in the reader's accent (`bg-orange-500`, which the accent setting re-points) with a dark check, ringed in the page colour so it reads on any picture. An item's `remove` puts a 20px remove disc on the picture's top-right corner, a `<RemoveButton>` (a trash when `remove.confirms`, the click opening a confirmation, else a cross) that `HOVER_REVEAL` shows on hover or keyboard focus and pins visible on a touch screen. A 36px disc would cover the 28px picture, so on a touch screen the disc keeps its size and its hit area becomes a 36px square up and right of it, starting 6px into the disc so the picture's centre stays its link. Each such picture then takes 16px more room above and 24px more on its right, which keeps the square clear of the line above and of the next picture. At most `max` show (5 by default); the rest fold into a `+N` bubble, a button when `onOverflow` is set.
  - [`<ActionMenu>`](../frontend/src/components/ui/ActionMenu.tsx) is the one menu of links and actions: a ghost trigger named by `label` (icon-only, or `text` printed before the icon, as the version selector's *v2*) that opens a `role="menu"` list painted with `TOOLTIP_SURFACE` and named by `menuLabel`. Each item is a link (`href`) or an action (`onSelect`, which closes the menu and gives focus back to the trigger before it runs), with an optional icon; `current` marks the link to the page on screen (`aria-current`), which takes focus when the menu opens, and `iconOnly` prints the icon alone, with the label as its accessible name and a `<Tooltip>`. A click, Enter or ArrowDown opens it and ArrowUp opens on the last item; the arrows, Home and End move between items; Space or Enter follows one; Escape closes and returns focus to the trigger; Tab or an outside click closes. The list is `14rem` wide, aligns to the trigger's right edge, shifts sideways to stay 8px inside the viewport, and scrolls past `20rem`. It renders in a portal fixed to the viewport and follows the trigger on scroll, so a box that scrolls sideways (the admin invite table) never clips it. `matchTriggerWidth`, off by default, makes the list exactly as wide as the trigger, for a compact picker. The event page's version selector is its consumer and sets it. The admin user card and the admin invite rows hold actions, and each destructive action opens a `<ConfirmDialog>`.
  - [`<Combobox>`](../frontend/src/components/ui/Combobox.tsx) is the keyboard and the list of every typeahead: a `role="combobox"` `<Input>` over a `role="listbox"` list painted with `TOOLTIP_SURFACE`, with `aria-activedescendant` on the highlighted row. The caller owns the query, the open state, the filtered options and how a row renders, and a `status` string shows as a muted row under the options. `pillOption` shows a row inside a neutral `<Pill>`, the chip a pick becomes. ArrowUp and ArrowDown move and wrap, Enter takes the highlighted row or hands the typed text to `onSubmitText` when no row is up, and Escape, Tab or an outside click closes. The list spans the field's width and scrolls past `15rem`. It renders in a portal fixed to the viewport, so a card or a scrolling rail never clips it, and it opens above the field when the room below is shorter than `15rem` and the room above is larger. While open it measures the field on every frame, so it follows the field when the page shifts around it without a scroll (an image above loading), and its edges stay 8px inside the viewport even while the field is partly out of it. `<AccountPicker>`, `<ConflictChips>`, `<TagChips>`, the admin event field and the collection picker's **Add events** field build on it.
  - [`<AccountPicker>`](../frontend/src/components/ui/AccountPicker.tsx) is the one way to pick an analyst or an organization, on `<Combobox>`. Each row shows the picture (a circle for an analyst, a rounded square for an organization), the name and, for an organization, its slug in muted text. The caller owns the data: `options` filters a local list by name and handle, and `search` runs the caller's request 250ms after typing stops, once the query holds `minQueryLength` characters. A `note` that `search` returns shows as a muted row, as do loading, a failed search and `emptyText`. With `selected`, the pick shows as an accent `<Pill>` chip that `onClear` removes; without it, the field empties after each pick. The approval request, the search Author filter, the co-geolocator invite, the organization invite, the admin org manager fields and the admin analyst search are its consumers.
  - [`<TagChips>`](../frontend/src/components/ui/TagPicker.tsx) picks tags from the one catalogue that serves events and sources. The picked tags show as accent `<Pill>` chips, and a click on a chip removes the tag. Under them, a `<Combobox>` suggests the other tags whose name holds the typed text, ignoring case. When no tag bears the exact typed name (case-sensitive, like the backend uniqueness rule), the list ends with *Create "name"*, which creates the tag through [`POST /tags`](api.md#post-tags) and picks it. A name that already exists on the server prints *That tag already exists.* under the field and keeps the typed text. The list stays open after a pick, so you can pick several tags in a row. Each tag in the list shows as a neutral `<Pill>`, and the *Create "name"* row stays plain text. The field's accessible name is *Tags* in the event's Details card and names the source in a source editor (*Source 1 tags*). On a form it spans its card; in the filter panel it stays at `max-w-xs`. With `filter`, the field is the Tags section of the [filter panel](#right-rail): it suggests the tags of the panel's catalogue, picks by name, the value the URL carries, and has no *Create "name"* row.
  - [`<ConflictChips>`](../frontend/src/components/ui/TagPicker.tsx), the conflict field of `<TagPicker>`, picks the event's conflicts from the conflicts referential, which the form fetches whole and filters in the browser. The picked conflicts show as accent `<Pill>` chips, and a click on a chip removes the conflict. Under them, a `<Combobox>` named *Conflict* lists nothing at rest. On focus or typing, it lists the ongoing conflicts whose name holds the typed text, ignoring case, each as a neutral `<Pill>`, ordered by tier then name (`sortConflicts` in [`lib/conflicts.ts`](../frontend/src/lib/conflicts.ts)). *Other* is pinned last and always offered, so a conflict outside the referential has a pick. The *Include ended conflicts* switch adds the ended conflicts. It sits on the label row, above the field, out of the way of a list that opens below the field. A picked ended conflict stays on show when the switch is off. The list stays open after a pick. When the publish floor misses the conflict, the label turns red and the field takes the `invalid` outline of every field (`FORM_INVALID_FIELD`). On a form the field spans its card like every other field; only the filter panel keeps it at `max-w-xs`. With `filter`, the field is the Conflict section of the filter panel: it lists every conflict in use (`GET /conflicts?used=true`), ended ones included, picks by name, and has no label row and no switch, since the section header carries the title and the `?`.
  - [`<LinkRow>`](../frontend/src/components/ui/LinkRow.tsx) is the icon, label and value row of the About page's links and the Notifications page. With an `href` it is one link; `external` leaves the app through `<OutboundLink>` with a trailing glyph. The opt-in `leading` node replaces the icon: each notification row leads with the 28px `<Avatar>` of who is behind it (`notificationAvatar` in [`lib/notifications.ts`](../frontend/src/lib/notifications.ts)), the organization's square logo on the rows where the organization acts (its approval landed, or it declined a request), the actor's circle otherwise, and the kind's icon when the row has no actor (a system kind or an erased account). The opt-in `variant="arrow"`, which the Notifications page uses, keeps the value in the neutral text colour, wraps it instead of truncating it, and ends the block with an orange `ArrowRight`, the in-app navigation glyph. Its link is stretched over the block, so the whole block is the click target, and hover or keyboard focus lights the border and the arrow. Its `action` node sits inside the block, left of the arrow, above the stretched link, so a click on it never follows the row. When the value and the action do not fit on one line, the action and the arrow wrap to a second line, right-aligned. `label` is optional, and the arrow variant takes a `meta` node, a muted `META_LINE` under the value for the date, the version, who, or a role or state pill. `meta` renders inside the link, so it holds text and pills, never a link. The organization page's lists and the admin Organizations panel use the arrow variant with `meta`. The About page rows keep the default variant: their orange value and trailing `ExternalLink` glyph mark where they leave the app.
  - [`<Tooltip>`](../frontend/src/components/ui/Tooltip.tsx) shows an icon-only control's label in a `TOOLTIP_SURFACE` bubble while a mouse rests on it or the keyboard focuses it. A touch never opens it, so a tap leaves no bubble standing. It reuses `usePinnedPopover`'s placement and dismissal. `tapToShow` is the one exception, for a control whose label is the only place a fact shows (an approval stamp, a count badge): a touch's first tap pins the bubble instead of acting, and a second tap on the same control acts. An outside tap, a scroll or Escape closes the pinned bubble. `underParent` hangs the bubble under the wrapper's parent rather than under the control, so a count badge's list drops under its button instead of over it. `<Button icon>` renders through it, so every icon button gets it with no call-site change; an icon link wraps itself in `<Tooltip label>`, a `display: contents` span.
  - [`<CountBadge>`](../frontend/src/components/ui/CountBadge.tsx) puts a red count on a control's top-right corner, of what the control still lacks: the missing conditions of a publish button, or the fields a collection's submit still refuses. The count is a `danger` `<Pill>` on a button beside the control, never inside it, so a tap on the control still acts. The badge's accessible name lists what is missing (*2 missing: Title, Conflict*), and a `<Tooltip tapToShow underParent>` shows that list under the control on hover, on keyboard focus, or on a tap on a touch screen, where the badge's hit area grows to about 36px. The control's `aria-describedby` reads the same list. A count of 0 shows no badge.
  - [`<AuthorByline>`](../frontend/src/components/ui/AuthorByline.tsx) is "by user". `avatar` leads with the author's picture instead of the "by " prefix, on the detail pages and the map side-panel header. `coAuthors` credits more analysts after the lead, each as its picture and linked name, side by side with a small gap and no separator on screen; with more than one name every name shows its picture. A screen reader hears "ana, bo and cy" through visually hidden separators. `coAuthorsAs="avatars"` keeps the lead as picture and name and shows each co-author as a picture alone, linked, named by its handle and showing it in a `<Tooltip>`: the feed and list cards and the event page header. Everywhere else a person is a picture and a name. An event's credit line is its owner and then every other geolocator (`creditProps` in [`geolocatorCredit.ts`](../frontend/src/lib/geolocatorCredit.ts)). `link={false}` drops the profile anchor for a slot that is already one click, such as a version-history row under its stretched link. The detail body's Author and Requested by rows both render through it.
- **Usernames.** A Vidit username prints bare, with no `@`: bylines, cards, admin panels, the search author filter, page titles, metadata, share text, and share cards. An `@` marks an external account only: a linked X or GitHub account (`displayLinkValue`), an X post author, the bot's replies on X, and `@viditbot`.
  - [`<Dot>`](../frontend/src/components/ui/Dot.tsx) is the accent "new content awaits" dot: sidebar nav badges (through `notify`), the rail's identity row when detections are pending, the profile's detections entry, the map filter panel's in-flight pulse, and the position dots of a carousel `<HorizontalScroller>`, grey except the current one. Position, ring, size and colour come through `className`.
  - [`<EmptyState>`](../frontend/src/components/ui/EmptyState.tsx) owns the empty-state grammar (`boxed` / `plain` / `invite`).
  - [`<LoadMoreRow>`](../frontend/src/components/ui/LoadMoreRow.tsx) is the foot of every [`useCursorList`](../frontend/src/hooks/useCursorList.ts) list: **Load more**, a spinner while the page loads, a failed page's message above **Try again**, and nothing once the walk ends. `infinite` loads the next page as the row nears the viewport (the feed). A failed first page leaves no rows and no row, so the list shows that error itself. The Requests board, the feed, the version history, the notifications page, an organization's Approvals card, the admin invite codes and the admin reports queue end on it. The reports queue is offset-paged, so it passes `useCursorList` a `next` reader that turns the payload's `page`, `per_page` and `total` into the next page number.
  - [`<ChipBucket>`](../frontend/src/components/ui/ChipBucket.tsx) is one filter family as a multi-select row of `<Pill>` chips. A selected option is accent, and a click toggles it. Any option in a bucket matches; combining buckets is the caller's rule (AND on the server). Use it for a small fixed set: the shared filter panel's Status, Source kind, Level, Media, Location guess and Approved only, and the feed's Kind. An open catalogue (conflicts, tags) takes a search field instead (`<ConflictChips>`, `<TagChips>`).
  - [`<ActiveFilterPills>`](../frontend/src/components/ui/ActiveFilterPills.tsx) is the one rendering of the applied filters: a removable accent `<Pill>` per filter, with **Clear all** after them once two or more are on. The map's filter overlay and [`<FilterBar>`](../frontend/src/components/filters/FilterBar.tsx) render it.
  - [`<StatTile>`](../frontend/src/components/ui/StatTile.tsx) is a labelled metric tile (icon, uppercase label, value), and `StatGrid` lays a row of them out in two columns, four from `sm` up. With an `href` the tile is one link into the view the figure was read from, with `TAPPABLE_HOVER` and an accent value. The profile insights use it.
  - [`<IconTile>`](../frontend/src/components/ui/IconTile.tsx) is an icon, a title and an optional one-line note in a bordered tile: the choosers on `/import` and `/submit`, and the concept rows on `/guide`. With an `href` the whole tile is one link with `TAPPABLE_HOVER` and an accent title on hover; without it the tile is inert. The icon is a node, so a brand mark such as `XGlyph` fits. The file also exports the tile's box and title classes, `TILE` and `TILE_TITLE`, for the plain example panels on `/import`.
  - [`<TileNotice>`](../frontend/src/components/ui/TileNotice.tsx) is the one muted line a media box says when it has nothing to show: an empty media set or a clip the browser refused.
  - [`BrandGlyphs`](../frontend/src/components/ui/BrandGlyphs.tsx) holds `XGlyph` and `GitHubGlyph`, the inline SVG brand marks that lucide does not ship. They paint `currentColor`.
  - [`usePinnedPopover`](../frontend/src/hooks/usePinnedPopover.ts) is the anchored-popover machinery (pin, hover, outside-click / Escape dismiss, portal plus viewport clamp), used by `FieldHelp` and `<Tooltip>`. Both bubbles paint with `TOOLTIP_SURFACE`.
- **Instruction lists.** [`<NumberedSteps>`](../frontend/src/components/ui/NumberedSteps.tsx) is the static "1, 2, 3…" list (numbered disc, title, body): `plain` on the public guides and under each `/guide` screenshot as its legend (the file also exports the plain disc as `STEP_NUMBER`, the marker on the `/import` annotated post), `boxed` with a per-step icon for the archive export steps on `/submit`. Every step looks the same because it is reference copy, not state. For a check mark or a spinner, use `<ProgressSteps>`.
- **Live progress.** [`<ProgressSteps>`](../frontend/src/components/ui/ProgressSteps.tsx) is the vertical stepper for a live multi-step operation (the archive import): check for done, highlighted disc for the active step, muted for pending. A determinate bar renders only when a real 0..1 `progress` ratio exists. A step in flight without one takes a discreet `spinner` next to its label, never a fake animation. `keepDetail` pins a step's detail line after completion (a privacy guarantee, a final count). `failed` turns the active step into the red failure marker. The message itself stays in the form's `FORM_ERROR_BANNER`.

#### Media

- [`<MediaGallery>`](../frontend/src/components/ui/MediaGallery.tsx) is the detail-surface block: `hero` tiles on the page, a lone tile at full width and two or more in a 2-up grid, and stacked `thumbnail` tiles in the panel.
- [`<VideoPlayer>`](../frontend/src/components/ui/VideoPlayer.tsx) is the one player, mounted by the gallery's video tiles and by the shared viewer. The landing page's demo clip is a one-off: it stays idle until a visitor clicks play, then hands playback to the browser's own controls.
- The player engine is [media-chrome](https://media-chrome.mux.dev): web-component controls around a native `<video>`, skinned through CSS variables on the controller (neutral-100 glyphs, flat controls on a translucent dark bar). This keeps the chrome independent of the React version and out of specificity conflicts with Tailwind.
- The bar holds play, scrub, time, mute, volume, download, and one big-view control. It hides after two undisturbed seconds of playback and returns on pointer move, hover, or focus.
- Big view is per context: a gallery tile carries an expand control that opens the shared viewer, and the viewer carries fullscreen. One such icon shows at a time.
- The viewer, [`<MediaLightbox>`](../frontend/src/components/ui/MediaLightbox.tsx), portals to `document.body` and layers above every floating surface (map panels, sidebar, banner), so a tile expanded inside the map's detail panel covers the viewport.
- The player fills its container and letterboxes, so a portrait clip keeps its shape over the tile's backdrop.
- A clip posters its first frame through the `#t=0.1` media fragment, since stored clips carry no poster derivative. [`posterFrameUrl`](../frontend/src/lib/mediaUrls.ts) owns this for every caller.
- Download is [`<MediaDownloadButton>`](../frontend/src/components/ui/MediaDownloadButton.tsx) everywhere. It fetches the object as a blob and saves it under its `original_filename`, because media is served from a separate origin, where a plain `<a download>` navigates to the file instead of saving it. An image tile's download floats under `HOVER_REVEAL` (invisible at rest, shown on hover or focus, permanent on a coarse pointer), the same cluster a proof image carries.
- `MediaThumb` is the card-sized media slot. It lives in [`<EntityCard>`](../frontend/src/components/ui/EntityCard.tsx) and is exported to the map's pin preview, the detections queue row, and each tile of a collection's mosaic, so its marked "no media" box is the site's one placeholder. A mosaic tile reads the slot's `size`: the 400 px derivative where it shares the mosaic, the 1280 px one where it fills it alone.
- Every card or preview thumbnail (events list, profile, feed, search hits, map pin hover, detections queue) is the backend-picked media: the file of the first source that has one, in source order, or else the first proof image, never a proof video. The pick lives in `backend/app/services/thumbnails.py`. The frontend renders what the payload carries and never re-derives it.
- [`<GraphicContentGate>`](../frontend/src/components/ui/GraphicContentGate.tsx) covers flagged media. A source carries its own flag (`is_graphic`, set by the analyst who writes the source, admin-overridable), so on the detail surfaces each [source block](#source-blocks) gates its own file and the others show. A card-sized slot and the proof body's images read the event's derived `is_graphic`, true when any source is flagged. The media renders blurred and inert behind an interstitial naming what is underneath. Confirming once, kept in `sessionStorage` for the browser session, reveals every gated instance on the page. `full` wraps `MediaGallery` on the detail surfaces, with the sentence and a confirm button. `compact` fills a card-sized slot (`MediaThumb`, the map pin preview, a proof body's inline images) with one labelled control.

#### Cards

[`<EntityCard>`](../frontend/src/components/ui/EntityCard.tsx) is the one catalogue card, `compact` (thumbnail beside the text) or `feed` (thumbnail under it).

- The whole card is a stretched link to `detailHref`. Anything interactive inside it is lifted above that link (`relative z-20`) and takes its own click.
- `onSelect` swaps that link for a stretched button, for a list whose rows pick a position on their own surface (a collection page's step list). In this mode the title renders as plain text and `detailHref` renders nowhere on the row. `selected` marks the row the surface stands on with the accent border.
- The byline shows on every catalogue surface, where a card stands beside other analysts' work, and credits every geolocator of the event (`coAuthors`): the owner as a picture and a name, each co-geolocator as a picture alone with its handle in a tooltip (`<AuthorByline coAuthorsAs="avatars">`). It is omitted on a surface that is one analyst's set and names them in its header (a collection's items).
- `age` adds how long an entity has been open to the compact row's meta line, after the date. The Requests board fills it from `requested_at` (see [Requests board](#requests-board)).
- On a phone the compact row narrows the thumbnail to `w-20` and drops the status badge under the text, so the title keeps its width.
- `uniformHeight` keeps every row of a catalogue list the same height whatever slots it fills (1-line or 2-line title, tags or none), from `sm` up. A list whose rows all share one short shape turns it off (a collection's items). Off, the row stands on its media column, and text shorter than that column centres against it.
- The thumbnail slot is `self-start`, so a tall card keeps the 16:9 ratio and leaves empty space under the thumbnail at every width. This is intended.

#### Controls

- A control carries colour while it acts and neutral grey when it cannot. For the disabled button, see [Buttons](#buttons).
- Every icon control on the site is the ghost icon button: one 32px square with one hover plate, on a page-header cluster, the profile header row, the archive mark beside a source link, and a field's trailing adornment. An action is `<Button icon variant="ghost">`. A control that navigates puts the same shape on a `<Link>` or an `<a>` through `buttonClasses("ghost", { icon: true })`, so a button never nests inside an anchor.
- An icon action that stands beside a field as its own item on the field's line is the outlined icon button, `<Button icon variant="secondary">`, so each action reads as its own box. The coordinate actions take it after the pair's two fields, and on every coordinates line, so the form and the reading surfaces show one look.
- A control with nothing to act on is that button `disabled`, which paints it grey and drops it from the tab order. An inert link becomes a disabled button.
- `aria-label` is the whole name, and every icon-only control shows it as a [`<Tooltip>`](../frontend/src/components/ui/Tooltip.tsx): `<Button icon>` does so on its own, and an icon link wraps itself in one. A `title` on an icon button becomes the tooltip text instead, for a longer hint such as *Edit (saves a new version)*, and the native `title` attribute is dropped so no second tooltip appears.
- [`<Switch>`](../frontend/src/components/ui/Switch.tsx) is the one boolean toggle (`md` settings rows, `sm` map filter rows; `as="span"` when a whole-row parent owns the click).
- [`<SegmentedControl>`](../frontend/src/components/ui/SegmentedControl.tsx) is the exclusive-choice bar (submit type, admin delete mode, the detections queue filter, the Requests board sort, the feed scope, the search result type; `tone="danger"` for a destructive active option). It stretches below `sm`, where each option starts from its label's width (see [Phone chrome](#phone-chrome)). A bar whose one-word labels need a sentence takes a `<FieldHelp>` beside it.
- `<Input icon>` overlays a leading icon (the search box). `<Input trailing>` overlays the field's own actions at the other edge, centred on the field's height and taking the pointer: the picker of a date field, the Wayback Machine door of a snapshot field.
  - Each trailing control is the ghost icon button, set a hair apart so two hover plates read as two controls.
  - The field is one height across its three variants, so the square sits inside any of them with a 3px gutter.
  - The field's text padding grows by `TRAILING_ROOM`, so a long value never runs under the marks. `FieldAdornment` and that constant are exported for `<LockedUrl>`, which renders as an anchor and clears the same marks by the same amount.
- [`<DateTimeInput>`](../frontend/src/components/ui/DateTimeInput.tsx) is the date / time / instant field. It sets `.picker-glyph`, which hides the engine's picker button (Webkit and Chromium only), puts a ghost icon button in the trailing slot (`Calendar` for a day, `Clock` for a time of day), and opens the native picker through `showPicker()`, falling back to focusing the field. It owns `has-value`, the class that mutes an empty field's `dd/mm/yyyy` placeholder. A date field too narrow for an adornment (the search filters, the map scrubber) stays a bare `<Input type="date">` with the native button.
- [`<Select>`](../frontend/src/components/ui/Input.tsx) is the pick-one-from-a-short-list field. It runs `<Input>`'s shape recipe under a custom caret, so a select and a text field on one row stay alike.
- [`<LinkListInput>`](../frontend/src/components/ui/LinkListInput.tsx) is the ordered list of links (each source editor's links): one row per link, and an add button that disables at its `max`. A row is the URL `<Input>`, the caller's `columns`, then the remove control, so the control ends the row it removes. A row is the caller's own value, read and written through `urlOf` and `withUrl`, so what else a row carries moves with it through every add and removal. Each column names its header and its grid track. `expansion` is a line across the row while the row is toggled open; the list owns which rows are open, and every row starts closed. The list is its own container (`@container`). From `@xl` (36rem) its rows share one grid under a header line, so a column keeps one width down the list. Narrower, each row is a small card: the URL with the remove control at the top right, the columns wrapping under it, where a fixed track is the cell's minimum width, capped at the card's width.
- [`<Disclosure>`](../frontend/src/components/ui/Disclosure.tsx) is a ghost toggle, a chevron and a label, that shows or hides a block of secondary fields under it (a source editor's **More details**). The parent owns `open`, so it picks the first state. The block stays mounted while closed, so its fields keep their values.
- [`<MergeAction>`](../frontend/src/components/ui/MergeAction.tsx) folds one item of a list into another. **Merge** opens a `<Select>` of the item to keep and a confirming **Merge** beside **Cancel**, so a stray click merges nothing. The caller does the merge.
- [`<ConfirmDialog>`](../frontend/src/components/ui/ConfirmDialog.tsx) is the confirmation step before a final action: `MediaOverlay`'s dialog variant around a `<Card>` with an accent border, as the outbound link dialog. It holds a title, a body that says what the action does and what cannot be undone, then **Cancel** and the primary confirm. `tone="danger"` paints the border red and makes the confirm the `danger` button, for an action that deletes, removes or closes something: closing an event, deleting an event, an analyst, an invite code, an organization or an approval, purging detections, revoking an invite code, removing a co-geolocator, withdrawing an invitation, and hiding a reported item whose owner deleted it, which erases it. Approving, requesting approval, reporting and a reversible hide keep the accent. **Cancel** takes the initial focus, so Enter on open sends nothing. **Cancel**, Escape and a click on the backdrop close it. The caller owns the request: `busy` holds both buttons while it runs, `error` prints its refusal inside the dialog, and `confirmDisabled` holds the confirm button while an input the dialog carries is incomplete (the target of **Request approval**, the typed slug of an organization delete). Every destructive admin action confirms in it: hiding or deleting an event, hiding a reported item, soft or hard deleting an analyst, purging their detections, revoking or deleting an invite code, and deleting an organization. The report form is one: its body holds the reason and the details, and **Send report** confirms.

#### Outbound links

```mermaid
flowchart LR
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`a surface that renders a link`"]:::spec
    l2["`a shared primitive`"]:::shared
    l3["`the one place the rule is written`"]:::core
    l1 ~~~ l2 ~~~ l3
  end

  surfaces["`**renderProof**, **ProfileIdentity**, **SourceLabel**, **LockedUrl**, **ArchivedCopies**, **LinkedAccountsLine**, **LinkRow**
  every absolute http(s) href`"]:::spec
  link["`**OutboundLink**
  rel, target, the click`"]:::shared
  kind["`**linkKind** in lib/outbound.ts
  parsed URL against VIDIT_HOST and KNOWN_HOSTS`"]:::core
  internal["`**next/link**
  same tab, in the app`"]:::shared
  known["`**a** in a new tab
  one click`"]:::shared
  unknown["`**MediaOverlay** dialog variant
  centred Card, the full URL is the link, Cancel`"]:::shared

  surfaces --> link --> kind
  kind -->|vidit.app, path not starting //| internal
  kind -->|known host, or host and path| known
  kind -->|any other host or path| unknown
```

[`<OutboundLink>`](../frontend/src/components/ui/OutboundLink.tsx) renders every link whose `href` is an absolute http(s) URL. A raw external `<a>` anywhere else is a review blocker.

- `linkKind` in [`lib/outbound.ts`](../frontend/src/lib/outbound.ts) reads the parsed hostname and compares whole labels: a host matches an entry when it equals the entry or is one of its subdomains. A substring never matches, so `x.com.evil.example` is an unknown host.
- A link to `vidit.app` or a subdomain routes in the app through `next/link`, in the same tab. A path that starts with `//` after parsing (`https://vidit.app//evil.example` or `https://vidit.app/\evil.example`) is an unknown link instead, because `next/link` reads that path as another host. `linkTarget` resolves it to that host, so the dialog names `evil.example` and its URL leads there.
- A link to a known host opens in a new tab in one click. `KNOWN_HOSTS` holds the snapshot hosts (`SNAPSHOT_HOSTS` in [`lib/snapshots.ts`](../frontend/src/lib/snapshots.ts)), the platforms analysts cite (`x.com`, `twitter.com`, `t.me`, `youtube.com`, `youtu.be`, `github.com`, `discord.gg`), and the links the app makes by design (`www.google.com/maps` for the map check, and the hosting providers on the legal page).
- A bare host entry covers its subdomains, so add the narrowest host that fits. An entry with a path covers that exact host and path only. `www.google.com/maps` matches `https://www.google.com/maps?q=48.85,2.35` and not `https://www.google.com/url?q=...`, which redirects anywhere. Never add a host that serves an open redirector.
- A link to any other host opens a warning dialog on click, middle click, or modifier click. The dialog is `MediaOverlay` with `variant="dialog"` from [`MediaLightbox.tsx`](../frontend/src/components/ui/MediaLightbox.tsx): it centres in the viewport over the page, dimmed and blurred in the theme's canvas colour (`neutral-950`).
- The dialog surface is a `<Card>` with an accent border (`orange-500`), so it follows the light or dark theme and the chosen accent.
- The dialog names the host and shows the full URL as a `TEXT_LINK`. The URL is the only way on: it opens in a new tab, so the reader reads the address to leave. There is no confirm button.
- **Cancel** is the one button and takes the initial focus. Tab stays inside the dialog. **Cancel**, Escape, or a click on the backdrop closes it, and focus returns to the link that opened it.
- Every rendered anchor carries `rel="noopener noreferrer"`. `ugc` adds `nofollow ugc` for text an analyst wrote: proof bodies, collection descriptions, and bios.
- A value that is not an http(s) URL renders as its text.
- Paint stays with the caller through `className`, so a source host, an icon button, and a link row keep their look.
- A `mailto:` link is not a web host and stays a plain `<a>` in the same tab.

#### Source blocks

An event's evidence is its list of [sources](data-model.md#sources), up to 10, none of them the main one. A reading surface renders one block per source and a form renders one editor per source. The block, the editor and the section that lists the editors live in [`components/sources/`](../frontend/src/components/sources), each with a `/palette` entry: [`<SourceBlock>`](../frontend/src/components/sources/SourceBlock.tsx), [`<SourceEditor>`](../frontend/src/components/sources/SourceEditor.tsx) and [`<SourcesField>`](../frontend/src/components/sources/SourcesField.tsx). [`EventDetailBody.tsx`](../frontend/src/components/event/EventDetailBody.tsx) renders the blocks, through `eventPageSlots` on the pages and `<EventDetailBody>` in the map side panel, so the full page, the map side panel and a version page render a source the same way. The source state, its payload and its floor have one home, [`lib/sources.ts`](../frontend/src/lib/sources.ts).

**On a reading surface**, the blocks follow the order the API serves (`direct`, then `indirect`, then `context`, then by capture time). Each block reads like the event's **Details** card: a [`<DetailCard>`](../frontend/src/components/ui/DetailRow.tsx) region named *Source N*, with the file in its lead slot and one `<DetailRow>` per field under it. It shows, in this order:

- The file in [`<MediaGallery>`](../frontend/src/components/ui/MediaGallery.tsx), behind its own [`<GraphicContentGate>`](../frontend/src/components/ui/GraphicContentGate.tsx) when that source is flagged. A direct or indirect source without a file shows the gallery's empty box, reading *No file*. A context source without a file shows no file area: the card starts with its rows.
- **Title**: the source's title.
- **Level**: a `<Pill>`, with the label the frontend owns for `direct`, `indirect` and `context`.
- **Kind**: the kind's label, followed by the file's kind after a middle dot when the source has a file (`sourceKindLabel`): *Drone · video*, *Smartphone · photo*, *Article*. A kind of `unknown` is dropped, since it tells the reader nothing: the row shows the file's kind alone, or drops out without a file.
- **Links (N)**, where N counts the links: the value is right-aligned like every other row, one item per link. Each item holds the link through [`<SourceLabel>`](../frontend/src/components/ui/SourceLabel.tsx), named by its host without a leading `www.` like the **Detected from** row (`safeHostname` in [`lib/format.ts`](../frontend/src/lib/format.ts)), with the full URL in the `href` and the `title`, followed by its archived-copy mark on the same line, then *Posted* and the post date and time in UTC in muted small text under it, or *Date unknown*. A post time of exactly 00:00:00 UTC shows the date alone (`formatInstantOrDate`): the API stores a date-only `posted_at` at midnight and records no separate "time known" flag, so midnight reads as an unknown time.
- The warnings of a satellite or aircraft source ([`SourceRead.warnings`](api.md#imagery-warnings)) through [`<SourceWarnings>`](../frontend/src/components/sources/SourceWarnings.tsx): one amber `WARNING_CALLOUT` line each, led by the host of the link it is about. They block nothing and are not a row. A version page shows none, since a snapshot keeps what the source said, not what the check says today.
- **Captured**: the capture date and time, in UTC.
- **Capture position**: the pair on one line through the `compact` `CoordinateValue`, the variant of the event's **Coordinates** row. The pair reads at 4 decimals in small monospace text, followed by the `small` [`<CoordinateActions>`](../frontend/src/components/event/CoordinateActions.tsx). The line never wraps: the row sets `wrapLabel`, so in a narrow card the label wraps instead. The copy still carries 6 decimals.
- **Tags**: the source's tags as `<DetailPills>`.

The rows read in the order of the editor's fields, the key order of `SOURCE_FIELDS`, which names both. A row with no value drops out. The map panel keeps its density: the same file and rows, bare (`compact`), in a `LIST_TILE`.

An event with no source yet reads *No source yet* under the eyebrow.

`eventPageSlots` (the event page, a version page, a request page) lays the blocks out in [`<SourcesRow>`](../frontend/src/components/sources/SourcesRow.tsx), at the top of the main column (see [Event layout](#event-layout)). The map panel stacks them under **Sources**. `<SourcesRow>` is the one sources row of the page and of every form: a row [`<HorizontalScroller>`](../frontend/src/components/ui/HorizontalScroller.tsx) in a region named *Sources*, whose header holds the **Sources (N)** `<SectionEyebrow>` with its `?`, the range and the arrows from two sources, and the caller's `actions`. Its `invalid` turns the eyebrow red and its `note` prints the reason in the header row.

With one source, the block takes the full width of the row, and the header holds the eyebrow alone:

- Its `<DetailCard>` sets `leadBeside`. Once the card is 42rem wide, the file sits on the left and the rows on the right, in a 3:2 split. In a narrower column the file stays on top of the rows.
- The file's `<MediaGallery>` sets `grow`, so the tile takes a 16:9 box at the full width of its slot instead of the fixed height. A video tile then takes the clip's own aspect ratio once `<VideoPlayer>` reads its metadata (`onAspectRatio`): the frame is centered, at most 28rem tall and at least 20rem wide, so a portrait clip plays in a portrait frame and the player bar keeps its controls at full size. The graphic gate and the player controls stay as they are.

With two or more sources, the blocks share the row. The scroller works as follows:

- The row scrolls sideways with native overflow scrolling, one snap point per item, by trackpad, touch or the arrow keys once the row has focus.
- Every item has the same width and the row's height, so a short block stretches to match its neighbour.
- Two items fit side by side once the row is 32rem wide. Below that, one item fits and the next peeks to show that the row scrolls. A lone item takes the full width of the row.
- With more than one item, the header shows the range in view (*1 to 2 of 5*) and the ghost icon buttons **Previous source** and **Next source**. An item counts as in view once half of it shows.
- Each button scrolls by one item, without smoothing under `prefers-reduced-motion`, and turns disabled at its end of the row. The left and right arrow keys on either button step the same way.
- With one item, the header holds the eyebrow alone.
- `actions` adds controls to the header after the buttons, at any item count. With one item, the header holds the heading and the actions alone.
- A ref's `show(index)` scrolls an item into view, so the caller can show an item it added or flagged.

The scroller's `carousel` variant, which the collection picker's held events use, differs from the row as follows:

- Each item takes the full width of the row, so one item shows at a time. A swipe on a touch screen moves to the next item through the same snap points.
- The header shows the previous button, the position (*2 / 3*, announced politely as *2 of 3*), then the next button.
- One dot per item sits under the row, the current one in the accent colour. A dot is a button that shows its item.
- The scrollbar is hidden, since the dots show the position.

[`<ArchivedCopies>`](../frontend/src/components/ui/ArchivedCopies.tsx) is that archived-copy mark, one per link:

- One link holds one copy, from whichever service produced it, so the mark is one ghost icon button carrying lucide's `Archive` box, for every state and provider, never a service logo.
- The provider lives in the accessible name of a stored copy (`Wayback Machine copy of source 1, t.me`), read off the link's `archived.provider`. `linkDescription` builds the rest of the name: the source's position, the link's position when the source holds more than one, and the host.
- The mark is accent where a copy exists and opens it. It is grey and inert where none does, for every reader including the event's owner. A missing copy is shown, not hidden.
- Nothing on a reading surface writes. Recording a copy is an edit, so the analyst archives from the form, and on a published event the save files a version naming the change.

**In a form**, the **Sources** section lays the source editors out in the event page's `<SourcesRow>`, each editor a `<Card>` region named *Source N*, with a visible *Source N* heading. The section has no card of its own: the row's header holds **Add a source** in its `actions`, so each editor is the only card. It starts with one editor, or one per stored source. The section works as follows:

- A lone editor takes the full width of the section and reads like the event page's lone source block: once the card is 42rem wide, the file sits on the left and the title, the level and the kind on the right, 3:2, with the links and **More details** under both at the card's width, so a link keeps its one-row layout; narrower, everything stacks. From two editors, they sit side by side with the row's sizing and peek. Every editor stays mounted, so one scrolled out of view keeps its input, its running upload and its red outlines.
- **Add a source** sits in the section header after the arrows. It appends an editor and scrolls it into view, and disables at the 10-source cap (`MAX_SOURCES_PER_EVENT`).
- While the list holds more than one editor, each editor carries a remove control at the top right of its header: a red `dangerGhost` trash icon button named *Remove source N*, with its name as a tooltip. The first click arms it in place (`useConfirmAction`): it turns filled red and takes the name *Confirm removing source N*. A second click within 3 seconds removes the editor; a click or focus elsewhere disarms it. Removing an editor shows the next one, or the previous one when it was the last.
- A publish attempt that flags a source field shows the first editor with a gap: a missing link or kind, else the first direct or indirect source when no source carries a file.
- To move a link to another source, paste it into that source's links, then remove it from this one.

An editor reads in the order of the event page's source block. It holds:

- The file slot, `MediaManager` on the generic [`FileManager`](../frontend/src/components/ui/FileManager.tsx). It is a single-file `grid`, so its one tile, or its drop zone, takes the full width of the editor at 16:9, and a stored or staged image loads its `_hero` derivative. A picked file uploads at once, on its own request ([`POST /uploads`](api.md#post-uploads)): the slot previews the local file with *Uploading <name>…* under it, then the staged copy from the returned `storage_url`. The form keeps the upload's id and posts it as the source's `upload_id`; a stored file posts back as `media_id`. A refused upload prints its reason under the slot and the slot takes another pick. Removing the file is a slot action. A form write waits for every running upload, with *Wait for the source files to finish uploading.*
- An optional **Title**, named *Source N title* for assistive tech so it reads apart from the event's **Title** field. A `<CharCounter>` on its label row reads it against `SOURCE_TITLE_MAX_LEN`, where it stops.
- The **Level**, a full-width `<SegmentedControl>` over **Direct**, **Indirect** and **Context**, on its own line, so its labels read in full in an editor half the row wide.
- The **Kind** under it, a `<Select>` over the generated kind values with the labels the frontend owns. Every source needs a kind, with or without a file, so the select starts on *Pick a kind* and is marked required on every form.
- The links: one row per URL through [`<LinkListInput>`](../frontend/src/components/ui/LinkListInput.tsx), capped at 10 (`MAX_LINKS_PER_SOURCE`), under **Add a link** (named *Add a link to source N*). A row holds, in order, the URL, its post time (UTC), its archive box and its remove control, under the headers *Links (N)*, where N counts the typed URLs (with the `source_links` help, red when a publish attempt flags a missing URL), *Posted (UTC)* and *Archive* on a wide list. The remove control is a red `dangerGhost` cross. On a narrow list a *Links* label with the same help sits above the cards, and each row is a small card: the URL with the remove control at its top right, then the post time and the archive box, side by side where both fit. At 320px the post time needs the card's whole width to show its value, so the archive box drops under it. A source needs at least one URL. Each URL and each archived copy stops at `SOURCE_URL_MAX_LEN` characters.
- On a **Satellite** or **Aircraft** source, [`<SourceImageryCheck>`](../frontend/src/components/sources/SourceImageryCheck.tsx) under the links. Once typing pauses, it runs [`POST /sources/check`](api.md#post-sourcescheck) on the kind, the capture date and the links, then names each provider a link opens in medium text, with its one-line reopening help and its expected credit in muted small text under it. The [imagery providers](imagery.md) list holds both, so the form mirrors nothing. A provider no reader can reopen shows no help: its warning says why. The warnings follow through `<SourceWarnings>`, the same lines the saved source shows. A failed check shows nothing, since the check is advice and never holds the write.
- **More details**, a [`<Disclosure>`](../frontend/src/components/ui/Disclosure.tsx). It starts closed, or open when one of its fields holds a value. It holds:
  - **Captured**, the capture date and time in UTC ([`<DateTimeInput>`](../frontend/src/components/ui/DateTimeInput.tsx)), and the **Capture position** ([`CoordinateInputs`](../frontend/src/components/geolocations/CoordinateInputs.tsx)), both optional. The capture position hides while the kind is **Article**, **Official statement** or **Other**, and such a source posts none. A capture pair that is half-typed, malformed or out of bounds outlines both fields in red, with a line under them that names the bounds, and the write leaves it out (`capturePositionInvalid`).
  - The source's tags (`<TagChips>`, from [`TagPicker.tsx`](../frontend/src/components/ui/TagPicker.tsx), the search field over the one tag catalogue the event's Details card reads).
  - **Graphic content** ([`<Switch>`](../frontend/src/components/ui/Switch.tsx)), with the `graphic_content` `?` saying what the flag does and who removes it. A flag the stored source already carries shows on and locked, since only an admin clears it.

A form checks the source floor before its write, from `sourceFloor` in [`lib/sources.ts`](../frontend/src/lib/sources.ts): a direct or indirect source with a file (the section heading turns red, and a red line beside it in the header row says so, so no editor moves down), a URL on every source (the **Links** header of the link list turns red), and a kind on every source (the editor's **Kind** label and select turn red). A refused write maps each source error code to one sentence (`sourceWriteError`).

On a form, the archive box sits in the row of the link it archives:

- `<ArchiveBox>` is that box, the row's *Archive* column. On a form it is never grey. A link with no copy shows an icon-only ghost button with the `ArchiveRestore` mark and an *Archive* tooltip, which opens the paste line under the row. A link with a copy, the stored one or a pasted snapshot on an allowed host, shows the copy itself: the `Archive` mark and the service's name, opening the copy, with `ArchiveRestore` beside it so a wrong paste can be replaced. On a wide link list the box is `9rem` wide in every state, so a copy appearing never narrows the URL and *Posted* fields; a long service name truncates and its tooltip shows it whole.
- `<ArchiveSnapshotField>` is the line it opens, across the row: one field, with no label, no optional marker, and no sentence. The placeholder states the contract (paste a snapshot from `web.archive.org`, `archive.today` or `ghostarchive.org`), and the check reads the full host list, `SNAPSHOT_HOSTS`, from [`lib/snapshots.ts`](../frontend/src/lib/snapshots.ts). Its own trailing mark opens the Wayback Machine prefilled with the URL currently typed in the row, so archiving a corrected URL is a re-click. It is the one form mark that goes grey: a link that does not parse has no page to open.
- Under the field there is at most one line: a red refusal for a value that cannot be a snapshot, or an amber `WARNING_CALLOUT` naming both URLs when the paste reads as an archived copy of a different link. The amber line blocks nothing.
- Every link of every source gets the pair, and the pair stays aligned with its link across an add or a removal. The form posts back each link's stored copy as its `snapshot_url`, since a link posted without one loses its copy.
- Every glyph looks alike, so the accessible name carries the state and the target: the source's position and the link's host, with the link's position when the source holds more than one, and a literal for a hostless URL.
- The box carries no `?` of its own. The link concept's `<FieldHelp>` describes the archive box once per section, so a source with ten links shows one explanation.

### Page chrome

Every main-app page uses [`<PageShell>`](../frontend/src/components/ui/PageShell.tsx), which owns the `title` / `titleField` / `subtitle` / `back` / `actions` / `stickyActions` / `controls` / `headerSide` slots:

| Element | Style | Notes |
|---|---|---|
| Column | `px-4 sm:px-6 lg:pl-[max(4.5rem,calc(50%-var(--container-6xl)/2-1.75rem))]`, then `max-w-[53rem]` (reading) or `max-w-6xl` (with a rail or a side column), then `pt-10 max-sm:pt-16 pb-16`, then `relative space-y-6` | One container across the app, so the title starts at the same x on every page. [`<PageFrame>`](../frontend/src/components/ui/PageFrame.tsx) owns the offset (`sm:pl-14`) and the container through its `column` prop. From `lg` up, the left padding centres a `max-w-6xl` column on the screen, with the sidebar counted as part of the left margin: on a 1512px screen the content starts 180px from the left edge and ends 180px from the right edge. The percentage resolves against the box inside the sidebar, not `100vw`, so a classic scrollbar does not push the column off centre. The padding never drops below 4.5rem, the gutter left of the title for the back arrow; where the screen has no room to spare, the column starts at that gutter and the free space falls on the right. A page with a rail takes `wide`, up to `max-w-6xl` (1152px) of content, which holds a 53rem main column beside the [right rail](#right-rail). A page without a rail takes `reading`, 53rem of content, the line length a centred `max-w-4xl` column leaves inside its padding. It starts at the same left edge as `wide`, so the free space falls on its right. `PageShell` picks the column from its `rail` and `headerSide` props: either one takes `wide`. [`EventShell`](#event-layout) always sets `headerSide`, so every event surface, a form included, takes `wide`. The side padding drops a step below `sm`, where the desktop gutter leaves the cards too narrow to hold a title beside a thumbnail on a 375px screen. The top padding steps up there instead, to clear the menu chip the rail leaves in the corner; see [Phone chrome](#phone-chrome). The public landing keeps `PageFrame`'s `center` column, the same width centred. |
| H1 (`title`) | `text-xl font-medium text-neutral-100` | Consistent on every page. |
| Title field (`titleField`) | In the H1's place; the H1 takes `sr-only` | A form whose first field is the title shows that field where the H1 reads, and the H1 stays the page's heading for assistive tech. [`EventShell`](#event-layout) sets it on the event forms. |
| Subtitle | `text-sm text-neutral-400` | Tight under the H1 (8 px gap). |
| Back arrow (`back`) | Track `max-sm:hidden mb-1 lg:absolute lg:inset-y-0 lg:right-full lg:mr-3 lg:mb-0 lg:pointer-events-none`, then `lg:sticky lg:top-10 lg:pt-1.5`, then the button `flex -ml-2 lg:ml-0 lg:pointer-events-auto` | Lives in the gutter from `lg` up, so the title's x-coordinate is the same whether back is present or not. The gutter is the column's left padding, at least 4.5rem from `lg` up. There the button sits in a track that spans the page's height, so it sticks at the top of the viewport while the page scrolls: `top-10` equals the frame's `pt-10`, so the arrow never moves, and `pt-1.5` levels it with the title. The track lets clicks through, so only the button itself takes them. Between `sm` and `lg` the button is a row of its own above the title, since a gutter-parked one lands under the fixed sidebar, where taps reach the nav rather than the button. Below `sm` the header carries no back control at all: the same button is portaled into the menu chip instead (see [Phone chrome](#phone-chrome)). `-ml-2` takes back 8 of the 9px the 36px square insets its 18px glyph by, so the arrow reads as aligned with the heading. **When to set it:** `back` marks a drill-in page reached from content (event / request detail, edit, profile, the detections queue), where "back" means "return to where I clicked this". Sidebar destinations (map, submit, requests, search, about, settings) never set it: they are entered from the rail, so there is no "where I came from" to promise. One exception: a `/submit` path sets it with `onBack`, which replaces the walk below and returns to the chooser, a step back through the history when the chooser opened the path and `/submit` otherwise. **What it walks:** [`smartBack`](../frontend/src/lib/navigation.ts) pops an app-kept stack of visited paths rather than calling `history.back()`, which would walk off the origin. A route that only redirects keeps itself out of that stack (`skipBackRecord`, called before the redirect), since walking back onto one runs its redirect again and lands where the walk started, which reads as an arrow that does nothing. |
| Actions (`actions`) | Right of the title, wrapping under it below a `14rem` title basis | The page-level action cluster. Every control that acts on the thing the page is about goes here, so a reader finds them in one place. On a profile that is the glyph row (the linked accounts, then Edit profile on your own), and Follow on someone else's profile. Edit mode moves the save pair to the sticky actions. The event surfaces leave it empty: their controls are sticky actions instead (`stickyActions`). A panel a cluster control opens (the add-to-collection picker, the Geolocators list) is a [`<Popover>`](../frontend/src/components/ui/Popover.tsx) that floats over the page, so nothing under the header moves. Flex line-breaking measures the title's base size, so the cluster takes its own line rather than squeezing a heading into a one-word column. A preference, not a minimum (`min-w-0`): a hard floor outgrows the frame on the narrowest phones and scrolls the page sideways. The cluster is capped at the header width (`max-w-full`) and wraps inside itself, so a row of several buttons breaks into right-aligned lines on a phone. The subtitle breaks anywhere, since a bio can hold a bare URL, one unbreakable token. |
| Sticky actions (`stickyActions`) | A zero-height `sticky top-10 max-sm:top-16 z-30` track before the header, the cluster hanging from it at the right, up to the side column's width from `lg` up | The page's actions, top right of the header, pinned at the top right of the column while the page scrolls, in an `aside` named *Actions* that `PageShell` renders, so no caller spells the landmark. [`EventShell`](#event-layout) sets it, on the event, version and request pages and the event forms. The collection forms and the profile and organization edit modes set it for their save pair. The header keeps the cluster's room, and the cluster takes a surface once pinned; see [Event layout](#event-layout). |
| Header in the column (`headerInColumn`) | The header and `controls` head the main column of a [right rail](#right-rail) page, beside the rail rather than above both | Off by default. The organization page sets it, so the rail's first block (an invited viewer's answer) sits top right, level with the title. The header scrolls with the main column while the rail sticks. The title keeps its x and the back arrow keeps its gutter, since the main column starts where the header did. Below `lg` the header comes first and a stacked rail follows it, so the actions sit under the title. |
| Controls (`controls`) | `flex flex-wrap items-center justify-between gap-2`, one `space-y-6` step under the header | The view controls: the `<SegmentedControl>` that picks what the page lists or how (the feed scope, the search result type, the Requests sort), left-aligned under the title. A companion control in the same node takes the row's right end (the board's **Post request**). The row sits above a [right rail](#right-rail), so the rail starts level with the list. |
| Header side (`headerSide`) | [`PageColumns`](../frontend/src/components/ui/PageShell.tsx): `grid items-start gap-6 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]` | Lays the page out as a main column and a side column, 65:35 from `lg` up. The header heads the main column and `headerSide` heads the side column, level with the title, under the sticky actions. The children lay out their own `PageColumns` under the header, on the same split, so the columns line up. Below `lg` each side column follows its main column. [`EventShell`](#event-layout) sets it on every event surface to what reads under the pinned row (`actions.below`), `null` when that is empty. |

Pre-data states use `<PageLoading>` / `<PageError>` (one centered shell). Opt-outs: `/` (landing), `/map` (full-screen map), the `(auth)/*` group, and `app/error.tsx`.

The public guides use the same shell, signed in or out: `/guide` ("Getting started", the page a new analyst reads first; see [Getting started page](#getting-started-page)), `/methodology` ("Building a proof"; see [Import and methodology guides](#import-and-methodology-guides)), and `/import` ("Import your work from X": the conditions once, an annotated post for what a detection carries, a screenshot of the Submit mode selector, then one section per entry). Each is a server component of `PageShell` plus `Card`, for SEO, linked from the About page's Guides section. `/bot` and `/archive` are `redirect()` stubs into `/import#bot` and `/import#archive`, and both stay in `PUBLIC_PREFIXES` so a signed-out reader is forwarded rather than sent to the login page. The bot's X bio points at `/bot` (see [The bot](ingestion.md#the-bot)).

The `(auth)/*` group composes [`<AuthCard>`](../frontend/src/components/auth/AuthCard.tsx) (a `max-w-sm` centered card). The two single-email pages (`/forgot-password`, `/resend-confirmation`) also share [`<SingleEmailFlow>`](../frontend/src/components/auth/SingleEmailFlow.tsx), whose sent-state copy stays anti-enumeration ("if X is registered…", never confirming the address exists).

`/unsubscribe/notifications` is an `<AuthCard>` too: it turns off the email of one notification kind only on a click of its button, so a mail scanner that opens the link changes nothing.

`/confirm-registration` consumes the token, signs you in, and then stays on its success card rather than redirecting. The card offers the two next steps as full-width links with `buttonClasses`: **Import your X archive** (primary, `/submit?import=1`) and **Read Getting started** (secondary, `/guide`).

#### Getting started page

```mermaid
flowchart LR
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff
  classDef data fill:#fdf3e7,stroke:#b8661a,color:#7a430f

  subgraph legend [Legend]
    direction LR
    l1["`a surface that links the page`"]:::spec
    l2["`a shared component`"]:::shared
    l3["`the page`"]:::core
    l4["`a file the page and the screenshot tooling share`"]:::data
    l1 ~~~ l2 ~~~ l3 ~~~ l4
  end

  email["`**registration_confirmation_email**
  a paragraph linking /guide`"]:::spec
  confirm["`**/confirm-registration**
  Read Getting started`"]:::spec
  about["`**/about**
  first entry of Guides`"]:::spec
  page["`**/guide**
  PageShell, one Card per section`"]:::core
  tiles["`**IconTile**
  imports, concepts`"]:::shared
  steps["`**NumberedSteps**
  screenshot legends, detection steps`"]:::shared
  badge["`**StatusBadge**
  one per status`"]:::shared
  shot["`**Shot**
  a screenshot and its legend`"]:::shared
  shots["`**shots.json**
  per page: file, window, session, markers and their labels`"]:::data
  script["`**screenshot tooling**
  run by the maintainer, writes public/guide/ and public/import/`"]:::data
  imp["`**/import**
  #detection, #archive, #paste, #bot`"]:::spec

  email --> page
  confirm --> page
  about --> page
  page --> tiles
  page --> steps
  page --> badge
  page --> shot
  imp --> shot
  shots --> shot
  shots --> script
  page -->|"Bringing your work in"| imp
```

[`/guide`](../frontend/src/app/guide/page.tsx) is a server component of `PageShell` plus `Card`, like the other guides. The page shows rather than tells: each section is a title, at most one sentence, annotated screenshots, and at most one row of `IconTile`s for what no screenshot shows. Each section is a `Card` whose `h2` carries the anchor:

| Anchor | Heading | What it shows |
|---|---|---|
| `#layout` | The layout | A screenshot of the signed-in rail on the map, and one of the phone drawer |
| `#reading-a-geolocation` | Reading a geolocation | A screenshot of an event page: byline, the source blocks with their files, links and archived copies, coordinates, details, proof, versions, share and report, approvals |
| `#statuses` | The statuses | The four `StatusBadge`s with one line each, and the steps from detection to geolocation |
| `#bringing-your-work-in` | Bringing your work in | Tiles to the archive, a pasted post and @ViditBot on `/import`, and to the submit form |
| `#working-with-others` | Working with others | A screenshot of the approvals on another analyst's geolocation, one of the Feed, and tiles for requesting an approval, co-geolocators and organizations |
| `#settings` | Your settings | A screenshot of the Notifications card (who can request your approval, the email switch per kind), and tiles for the profile, the X handle and display |

- **Anchors are contract.** Other pages and messages link to a section by its id, so keep every id when you edit a heading. Each heading takes `max-sm:scroll-mt-16`, so a jump on a phone lands below the menu chip.
- **One marker list.** [`shots.json`](../frontend/src/app/_shots/shots.json) groups the screenshots by page, `guide` and `import`, and names each one's file, route, window, session and markers. The layout, Approvals, Feed, Notifications and Submit shots are signed in. A marker is a target element and its legend line. The screenshot tooling is not part of this repository. It draws a numbered orange disc beside each target and writes the WebP to `frontend/public/<page>/`. [`Shot`](../frontend/src/app/_shots/Shot.tsx) renders one screenshot on either page and numbers the same labels with `NumberedSteps` under the image. Change a marker in the JSON, and the maintainer regenerates the screenshots.
- **Grounded in the product.** The page names only controls that exist, under the labels the product prints. A change to a surface the page shows updates its tile or its markers in the same PR, and the maintainer regenerates its screenshot.

#### Import and methodology guides

The three guides chain: `/guide` links `/import` and `/methodology`, and neither of those restates what another guide owns. A fact lives in one guide, and the others link to it:

| Fact | Owner | Linked from |
|---|---|---|
| The four statuses and the path from detection to geolocation: on the map and in your queue, you review, only you publish, rejecting closes it | `/guide#statuses` | `/import`, one sentence after the annotated post |
| What makes a detection: your own post from your linked X handle, carrying a coordinate | `/import#detection` | `/guide#bringing-your-work-in` |
| What a detection carries, and the parsing rules (coordinate formats, a quote outranks links, links that never count, the 120-character title, several candidates leave the source empty) | `/import` | No other guide |
| Each way in: the archive, a pasted post, @ViditBot | `/import#archive`, `#paste`, `#bot` | `/guide` tiles, as navigation |
| What a proof is and how to build one | `/methodology` | `/guide#reading-a-geolocation` |

- **The annotated post.** [`/import`](../frontend/src/app/import/page.tsx) shows what a detection carries as a `MockPost` of a typical geolocation post, a quote of the source post with its footage, and numbers its parts with the `STEP_NUMBER` disc that [`NumberedSteps`](../frontend/src/components/ui/NumberedSteps.tsx) exports: 1 coordinates, 2 the source, 3 the source media, 4 the title line, 5 the proof text. A `NumberedSteps` legend beside it gives one line per number, and a short list under it holds the rules a reader needs when a detection looks wrong.
- **The entry chooser.** Under "Three ways in", `/import` shows the `submit-modes` screenshot of the `/submit` chooser: 1 the chooser, 2 Single event, 3 From an X post, 4 Bulk import. A line under the legend says that @ViditBot needs no form. The `IconTile` row under it links each entry's section, which the screenshot does not.
- **The proof example.** [`/methodology`](../frontend/src/app/methodology/page.tsx) opens on one real proof image from a public geolocation, stored as `frontend/public/methodology/proof-example.webp` and captioned with the analyst and a link to the event page. Numbered discs are baked into the image, and each number marks the step of the same number in the list under it, so a reorder of the first four steps re-bakes the image.

#### Right rail

```mermaid
flowchart TB
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff
  classDef page fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef state fill:#fdf3e7,stroke:#b8661a,color:#7a430f

  subgraph legend [Legend]
    direction LR
    l1["`the layout primitives, thick-bordered`"]:::core
    l2["`shared filter piece`"]:::shared
    l3["`a page that mounts it`"]:::page
    l4["`what the reader sees`"]:::state
    l1 ~~~ l2 ~~~ l3 ~~~ l4
  end

  shell["`**PageShell rail=…**
  PageFrame column=wide: up to 1152px, left-aligned`"]:::core
  layout["`**PageWithRail**
  53rem main column plus a 17.5rem rail`"]:::core
  pages["`**Feed, Requests board, Search**
  rail: EventFilterSections; narrowRail=hidden`"]:::page
  wide["`**lg and up**
  rail sticks beside the list, scrolls on its own when taller`"]:::state
  narrow["`**below lg**
  rail leaves the page`"]:::state
  bar["`**FilterBar**
  Filters (N) button and the active-filter pills`"]:::shared
  dialog["`**MediaOverlay dialog + Card**
  the same panel on a draft: Cancel, Clear, Apply`"]:::shared
  list["`**the list**
  refetches once, with the applied filters`"]:::state

  pages --> shell --> layout
  layout --> wide
  layout --> narrow
  narrow --> bar
  bar -->|Filters N| dialog
  dialog -->|Apply| list
```

[`<PageWithRail>`](../frontend/src/components/ui/PageWithRail.tsx) lays a page out as a main column and a right rail. Use it for any page whose side panel stays in view while its main column scrolls. Pass the panel as `<PageShell>`'s `rail` (with `railLabel` and `narrowRail`): `PageShell` composes `PageWithRail` and widens its column to `wide`, so the main column keeps the 53rem reading width beside the rail once the screen holds both. A page whose rail comes and goes passes `null` while it is gone, which keeps the column one width and keeps its element mounted.

- **From `lg` up** the rail is a `17.5rem` (280px) column right of the main column. It sticks while the main column scrolls, at its resting top, so it never moves: `PageShell` sets `--rail-top` to the frame's `pt-10` (2.5rem), plus the header's measured height and the 1.5rem gap under it when the header sits above the rail. Once the rail is taller than the viewport it scrolls on its own, so its foot stays reachable.
- **Below `lg`** the `narrow` prop picks the shape. `stacked` (the default) puts the rail above the main column. `below` puts it under the main column, for a rail that acts on what the column holds; the rail also comes after the column in the tab order at every width. `hidden` takes the rail off the page, for a page that offers its own narrow entry to it.
- **Without a `rail`** (`null`) the page takes the `reading` column, so a page can drop the rail on a view it does not apply to.
- **With `headerInColumn`** `PageShell` passes its header to `PageWithRail` as `header`, which heads the main column (`lg:grid-rows-[auto_1fr]`, the rail spanning both rows). The rail's top is then level with the title.

The organization page mounts an invited viewer's **Accept** and **Decline** in the rail with `headerInColumn`, and drops the rail for everyone else. The event forms place their actions in [`EventShell`](#event-layout)'s sticky actions instead of a rail. The feed, the [Requests board](#requests-board) and search mount the shared filter panel ([`EventFilterSections`](../frontend/src/components/filters/EventFilterSections.tsx)) in the rail with `narrowRail="hidden"`. The map keeps its floating overlay panel. Above each list sits [`<FilterBar>`](../frontend/src/components/filters/FilterBar.tsx): the removable active-filter pills, and below `lg` a **Filters** button that reads **Filters (N)** while N filters are active. The button opens the same panel full screen in `MediaOverlay`'s dialog variant around a `<Card>`. The panel there edits a draft, so the list refetches once:

- **Apply** applies the draft and closes the dialog.
- **Clear** empties the draft. Apply then clears the list's filters.
- **Cancel**, Escape or a tap on the backdrop closes the dialog and drops the draft. While a search field's list is open, Escape closes the list only.

The pills act on the applied filters at every width. Every applied value has its pill, the author included (**By** *username*), and counts once in **Filters (N)**. The pill row hides from `lg` up while no filter is active, since the button is off the page there.

#### Phone chrome

The nav chrome takes three shapes, and the page offset follows it:

| Width | Nav | Page offset | Back control |
|---|---|---|---|
| Below `sm` (640px) | The rail is off-canvas. A floating menu chip in the top-left corner opens it as a drawer. | No left inset. `PageShell` takes `max-sm:pt-16`, so the title clears the chip. | Portaled into the chip, beside the open control. |
| `sm` to `lg` | Fixed 56px rail, collapsed to glyphs or expanded to labels. | `sm:pl-14`, from `PageFrame`. | A row of its own above the title. |
| `lg` up | The same rail. | `sm:pl-14`. | Parked in the gutter left of the column. |

**The chip is the rail's chrome while the rail is off-canvas** ([`Sidebar.tsx`](../frontend/src/components/Sidebar.tsx)): an opaque `neutral-900` box on a `neutral-800` border, 8px in from the top and left edges, holding a 44px open control (lucide's `Menu`) and, beside it, a slot for the page's back control. It costs the corner it occupies and nothing more, which is why each page clears it with its own top padding rather than every route surrendering a row to a bar. `PageShell` portals its back control into that slot below `sm` through [`phoneBackSlot.ts`](../frontend/src/lib/phoneBackSlot.ts), so a page carrying one shows the arrow beside the open control and every other page shows the open control alone. The brand mark stays in the drawer, where it doubles as the Home entry.

**The drawer is the rail's expanded state**, slid over the page: 192px wide, glyphs plus labels, the identity block at the foot, and the beta pill inline under it. A `black/50` scrim covers the page behind it, and the body stops scrolling while it is open. It closes five ways: a tap on any link inside it (the entry already active included, which changes no route), a route change, Escape, a tap on the scrim, and the foot control, which reads *Close* below `sm` and *Collapse* from `sm` up: one row at every width, but two buttons, since closing the drawer and folding the rail act on different state.

**The beta pill has one live copy at any width** ([`BetaBanner.tsx`](../frontend/src/components/BetaBanner.tsx)). The floating corner pill paints over a phone's content, so it hides below `sm` and the drawer renders the same component inline at its foot.

**The map page lays its overlays out around the chip.** The filter bar starts right of the chip's open control (`left-16`), and the overlay stretches to 16px above the viewport bottom, laying its bar, its active-filter strip and its section stack out as a column: the stack takes the height the other two leave and scrolls the rest, so the tag and author sections stay reachable. The stretched box passes pointers through, so the map keeps every tap outside the blocks themselves. The detail panel becomes a bottom sheet: full width on the bottom edge, capped at `60dvh`, scrolling its own content, under a grab bar above its close control. The bar is decorative, and marks the sheet as the scrolling surface; the close control dismisses it. The map's bottom-left control group keeps the map's own corner below `sm`, since the 60px offset in [`globals.css`](../frontend/src/app/globals.css) clears a rail that is not there; an open sheet covers that group, and closing it hands the group back.

**A finger gets slop on the canvas** ([`Map.tsx`](../frontend/src/components/map/Map.tsx), [`stack.ts`](../frontend/src/components/map/stack.ts)). On a coarse pointer, a tap that hits bare canvas is re-tested over a 12px box on each side and takes the feature whose projected centre sits nearest, then does what that feature's own layer would have done: a cluster zooms, a stack badge fans out, a pin selects. A ring dot keeps its 12px paint and grows a 32px hit box around it. A tap arms no hover preview, since the compatibility `mousemove` a tap fires would open the card over the pin the finger just selected. A mouse keeps exact hit testing and its preview. The pointer read has one home, `isCoarsePointer` ([`pointer.ts`](../frontend/src/lib/pointer.ts)), on the same media feature the `pointer-coarse:` variant carries in CSS.

**A [`<SegmentedControl>`](../frontend/src/components/ui/SegmentedControl.tsx) always stretches below `sm`**, its options sharing the track and their labels staying on one line. An intrinsic-width track with three labelled options runs past a 375px column, and the browser's answer there, wrapping each label, reads broken. Each option starts from its label's width and the spare room is shared out, so the longest label keeps its words: equal thirds at 320px cut *People I follow* in the settings to *People I f…*.

**A form field renders at 16px on a phone** ([`Input.tsx`](../frontend/src/components/ui/Input.tsx)). `FIELD_TEXT` is the one field type size, 16px below `sm` and 14px from `sm` up, and the three `<Input>` variants, `<Select>`, `<Textarea>` and the locked box all run it. Mobile Safari zooms the page in when you focus an editable element rendering under 16px, and it does not zoom back out when you leave the field, so a smaller field leaves you scrolled sideways on the form you were filling in. The map scrubber's date fields, the one field that sets a denser size of its own, carry it as `sm:text-[11px]`, so they keep the dense desktop size and take the floor on a phone. The field's height follows its type size, 38px from `sm` up and 42px below it.

**A field's trailing actions are cleared by one figure at each size**, `TRAILING_ROOM` in the same file. The widest adornment holds two ghost icon buttons and the icon button steps from 32px to 36px on a phone, so the text padding that clears it is `pr-18` from `sm` up and `pr-20` below. [`<LockedUrl>`](../frontend/src/components/geolocations/fields/LockedUrl.tsx) reads that constant too, so its value stops where an adorned field's does. A mark that stands down on a phone takes `sm:pr-10`, one icon button's room from `sm` up and none below, which the field asks for with `trailingFromSm`: `<Input>` then hides the slot below `sm` and leaves the field its full width there, so the two halves of the decision stay together. [`<DateTimeInput>`](../frontend/src/components/ui/DateTimeInput.tsx) takes that form for every date, time and instant field: at 320px the instant in a link's post time field needs the whole field, so the picker mark is a desktop affordance, and below `sm` a tap on the field opens the engine's own picker. The narrow-viewport suite measures the room the instant field leaves against the width the engine paints its value in.

**The coordinate pair holds one line at every width** ([`CoordinateInputs.tsx`](../frontend/src/components/geolocations/CoordinateInputs.tsx)). The line is a three-column grid: Latitude and Longitude share the room in two shrinking columns, and the map and copy actions take only their own width after them. The pair has no visible labels: each field is named for assistive technology (`aria-label`, *Latitude* and *Longitude*) and shows an example value as its placeholder, and a refused pair turns both fields red (`FORM_INVALID_FIELD`). The fields run half the usual side padding and tight tracking, so a 6-decimal value shows whole from 375px up and in the forms' side column at 1024px. At 320px the 16px field text and the 36px tap squares leave room for about 6 characters, and the rest scrolls inside the field. The narrow-viewport suite measures the line in the Location card and in a source editor at both phone widths and at 1024px.

**An embedded map hands the one-finger swipe back to the page** ([`Map.tsx`](../frontend/src/components/map/Map.tsx)). The `embedded` prop sets MapLibre's `cooperativeGestures` on the event page's location box and on the profile map, which drops the canvas to `touch-action: pan-x pan-y`: a swipe that starts on the map scrolls the article, panning takes two fingers, and zooming takes Command or Ctrl with the wheel, announced on the blocked gesture. On desktop, a bare wheel over either map scrolls the page, and MapLibre paints its own overlay saying to hold Command or Ctrl. `/map` leaves the prop unset, since there the map is the page.

**The page frames on `dvh` and paints under the cutout.** [`app/layout.tsx`](../frontend/src/app/layout.tsx) exports `viewport` with `viewportFit: "cover"`, so the document reaches the physical edges of the screen.

- Every surface that owns the screen size takes it on `dvh` rather than `vh`: the document body, both page frames (`<PageFrame>` and `<PageCenter>`), the map page, the media lightbox, and the global error boundary. `vh` is the tallest the viewport gets, so with mobile Safari's URL bar showing, a `vh` frame pushes centred blocks low and puts the last row behind the bottom chrome.
- Edge chrome takes the insets back through the `safe-*` utilities in [`globals.css`](../frontend/src/app/globals.css). A surface that floats a set distance from an edge takes the inset as a margin: the menu chip, the map's filter overlay, and the map's detail panel from `sm` up. A surface that fills an edge takes it as padding, so its box still reaches the edge: the nav drawer, the map's bottom sheet, and the media overlay, whose backdrop covers the cutout band so a tap there closes the viewer.
- The nav element takes that padding only while it is the drawer (`max-sm:`). From `sm` up it is the 56px rail, which takes no inset and paints under the cutout band, since a notched phone in landscape is past `sm` and the inset would leave 12px for the glyphs.
- The page column takes its horizontal insets in `<PageFrame>` and `<PageCenter>` ([`PageFrame.tsx`](../frontend/src/components/ui/PageFrame.tsx)), which keeps every route's content out from under the cutout in landscape.
- `env()` reads 0 where the device reports no inset, so both forms are inert on a desktop.

**The media lightbox scrolls instead of overflowing** ([`MediaLightbox.tsx`](../frontend/src/components/ui/MediaLightbox.tsx)). The frame is `80dvh` inside an `overflow-y-auto` overlay, so a video's control bar stays on screen with the iOS URL bar visible. The content sits at the top of the overlay with auto vertical margins, which centre it while it fits and collapse to 0 when it does not, so nothing lands above scroll origin. The content is sized by what it holds rather than clamped to the overlay's height, so a tall frame scrolls.

**An interactive chip and a filter-section header are tap targets.** `TAP_STEP` ([`Button.tsx`](../frontend/src/components/ui/Button.tsx)) is the one phone floor, 36px below `sm` and the exact desktop shape from `sm` up. It raises the tappable height only, so a control keeps its own type scale and its own horizontal padding. [`<Pill>`](../frontend/src/components/ui/Pill.tsx) takes it whenever it carries an `onClick`, which is every conflict, source kind, level, tag and status chip, every removable active filter, the `<AccountPicker>` chip and every `<TagPicker>` conflict and tag chip; a static pill is a label and keeps its resting height. [`<FilterSection>`](../frontend/src/components/ui/FilterSection.tsx) makes its whole header row the target the way [`<ToggleRow>`](../frontend/src/components/ui/ToggleRow.tsx) makes its row the switch: each of the two toggles carries the step and the row's vertical padding, and the summary and chevron one grows into every pixel right of the title, so the `?` is the only part of the header that is not a toggle. Put the step on the row instead and it sizes the row while each button keeps its own 16px line box, which is a 36px strip holding two 16px targets. The quiet text control of the same surfaces, `Clear all`, takes the step as well. A square control smaller than the icon button takes the same floor through `ICON_TAP_STEP`, the width and the height together: the settings accent swatch, a `<FileManager>` tile's remove control, the map scrubber's play and reset controls, and the sidebar's three community links, each naming its own desktop square beside it.

**A boolean preference is a [`<ToggleRow>`](../frontend/src/components/ui/ToggleRow.tsx).** Its accessible name is its label alone (`aria-label`), and its description is its accessible description. The whole row carries `role="switch"` and the click and `<Switch>` renders as its visual span, so a tap anywhere on the row toggles rather than having to land on the 20x36px track, and the row takes `TAP_STEP`. A `description` picks the shape: without one the row is the filter toggle, a micro uppercase label on a divided list; with one it is a settings preference, the label at reading size over a line saying what the preference does. The accessible name is the label alone (`aria-labelledby` on it), so a screen reader announces the switch by what it switches, and the description is its accessible description. `disabled` reads the state but refuses the toggle and dims the row; give it a `description` that says when the switch applies.

**Settings → Notifications is a list of described [`<ToggleRow>`](../frontend/src/components/ui/ToggleRow.tsx)s.** Each row is one notification kind with one **Email** switch, its label and description on the left. The switch applies to the account, whatever the device. The in-app notifications list shows every kind and has no switch. The approval-request audience sits outside the list.

**A pick-one preference is a [`<ChoiceRow>`](../frontend/src/components/ui/ChoiceRow.tsx).** It is the `<ToggleRow>` shape for a setting with a few named choices: the label at reading size over a line saying what the setting does, and a `<SegmentedControl>` named by the label. Settings and the organization page both render **Accept approval requests from** through it. Below `sm` the bar drops under the text and takes the full column.

**A colour preference is a [`<SwatchPicker>`](../frontend/src/components/ui/SwatchPicker.tsx).** It is an ARIA radiogroup of round swatches. The selected swatch is the one tab stop, the arrow keys move focus and selection together and wrap at the ends, and Home and End jump to the ends. The selected swatch wears a light ring and the focused one an accent ring. Settings → Display uses it for the accent colour.

**A pill never outgrows the box it sits in.** `<Pill>` holds its width against its neighbours (`shrink-0`), which is what keeps a badge from being squeezed on a crowded row, so a pill carrying one long word would hold its full width and run past its container. `max-w-full` bounds the box and `wrap-anywhere` breaks the word inside it, so a long tag name on the request card's content column takes a second line rather than scrolling the page sideways. Use `wrap-anywhere` (`overflow-wrap: anywhere`) and not `break-words`: a pill is an `inline-flex` box, sized by its content's min-content width, and a `break-word` opportunity is excluded from that measurement, so the box would stay as wide as the unbroken word. The same token breaks the account email on the settings page and the page subtitle in `<PageShell>`.

**A detail row gives way rather than squeezing** ([`DetailRow.tsx`](../frontend/src/components/ui/DetailRow.tsx)). Label and value share one line at every width, and `*:min-w-0` lifts the automatic flex floor off both halves, so a value carrying `truncate` cuts itself to the room the row leaves and a value that wraps on its own (a close reason, a tag list) takes the lines it needs beside the label. The label never shrinks, so it stays on one line at every width. The row does not wrap: wrapping drops a truncating value onto a line of its own before `truncate` engages, which is a different row from the one the desktop map panel is laid out as. `gap-x-4` is the only gutter between the two halves, so a value adds no margin of its own. [`<SourceLabel>`](../frontend/src/components/ui/SourceLabel.tsx) truncates against that rule rather than against a width ceiling of its own, which is why it takes no width prop. A `wrapLabel` row is the one exception to the fixed label: its value holds one line at its full width (`shrink-0`), so the label wraps instead when the row runs short (a source's **Capture position**, the event's **Coordinates**).

#### One event, four surfaces, two writes

An event is read on four surfaces and written by two endpoints.

```mermaid
flowchart TB
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff
  classDef store fill:#0b5c5b,stroke:#083f3e,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`an address a reader can open`"]:::spec
    l2["`a shared component`"]:::shared
    l3["`the write behind it`"]:::core
    l1 ~~~ l2 ~~~ l3
  end

  canonical["`**/events/{id}**
  canonical, always the current version`"]:::spec
  history["`**/events/{id}/history**
  one row per version, newest first, on the shared cursor`"]:::spec
  vn["`**/events/{id}/vN**
  the record as version N stood; noindex plus a canonical link back`"]:::spec
  panel["`**the map side panel**
  a preview of a row whose page is one click away`"]:::spec

  body["`**EventShell** filled by **eventPageSlots**
  the record's page, rendered by the canonical page and by every version page`"]:::shared
  snap["`**snapshotToEventView**
  maps a stored snapshot onto the live row's shape`"]:::shared
  actions["`**useEventActions**
  the header (version, Edit, Share, and per-reader icons) and the approvals`"]:::shared
  form["`**EventEditForm** at **/events/{id}/edit**
  one form, two shapes chosen by the row's status`"]:::shared

  ver["`**POST /events/{id}/versions**
  a request or a detection: publishing files version 0; a geolocated row: saving adds a version and overwrites nothing`"]:::core
  rows[("`**events + event_versions**`")]:::store

  canonical --> body
  vn --> snap --> body
  canonical --> actions
  history --> vn
  canonical -->|"History"| history
  actions --> form
  panel --> canonical
  form -->|"requested, detected or geolocated"| ver
  ver --> rows
```

The history list's `Current` row opens the canonical page rather than a version address, since that is where the record as it stands is read.

#### Event layout

```mermaid
flowchart TB
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff
  classDef pinned fill:#f3e8fb,stroke:#7a4aa5,color:#4f2f6b
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef state fill:#fdf3e7,stroke:#b8661a,color:#7a430f

  subgraph legend [Legend]
    direction LR
    l1["`the shell, thick-bordered`"]:::core
    l5["`pinned at the top right while the page scrolls`"]:::pinned
    l2["`main column: the evidence`"]:::shared
    l3["`side column: the context`"]:::spec
    l4["`full width, between the zones`"]:::state
    l1 ~~~ l5 ~~~ l2 ~~~ l3 ~~~ l4
  end

  shell["`**EventShell**
  the one entry point: event, version and request pages, edit and submit forms`"]:::core

  subgraph top [Header, on PageShell]
    direction LR
    subgraph titlesection [1. Title section]
      direction TB
      heading["`**back**, **title**
      on a form, **titleField** in its place, the page name a hidden h1`"]:::shared
      byline["`**byline**, one line
      the geolocators; on a form, their remove discs and the add button's Popover`"]:::shared
      heading --> byline
    end
    subgraph actionsblock [2. Actions block]
      direction TB
      pinned["`**actions.pinned**
      the actions row, or a form's writes`"]:::pinned
      under["`**actions.below**
      the approvals, an invitation, or a form's hidden incomplete announcer`"]:::spec
      pinned --> under
    end
    titlesection ~~~ actionsblock
  end

  between["`**panels**
  the panels the actions open, the version banner`"]:::state

  layout["`**EventLayout**
  3. the body, filled by eventPageSlots or eventFormSlots`"]:::core

  subgraph body [Body]
    direction LR
    subgraph main [Main column]
      direction TB
      sources["`**sources**
      Sources (N), or the source editors`"]:::shared
      proof["`**proof**
      Proof, or the proof editor`"]:::shared
      sources --> proof
    end
    subgraph side [Side column]
      direction TB
      location["`**location**
      map and Coordinates, or the Location field`"]:::spec
      details["`**details**
      the Details card`"]:::spec
      location --> details
    end
    main ~~~ side
  end

  shell --> top --> between --> layout --> body
```

[`<EventShell>`](../frontend/src/components/event/EventShell.tsx) is the one shell of an event, and the only place that lays one out. The event page and the request page render it through [`EventReadPage`](../frontend/src/components/event/EventReadPage.tsx) (the row, its actions for the surface and `EventByline`, the byline built from the row), a version page directly, and the [owner edit form](#the-owner-edit-form) and the [submit form](#forms) through `EventFormShell`; each fills the slots of its three zones, so a block sits in the same spot on every surface. The zones are the title section, the actions block and the body. To move a block, change `EventShell` or its body grid, [`EventLayout`](../frontend/src/components/event/EventLayout.tsx); a page only fills slots. The shell builds on `PageShell`: the title section is its header, with `titleField` in the title's place; the actions block's pinned row is `stickyActions`, and what reads under it is `headerSide`. The body is a `PageColumns`, 65:35 from `lg` up (`PAGE_COLUMNS_SPLIT` in [`PageShell.tsx`](../frontend/src/components/ui/PageShell.tsx)), the split the header's columns take. The main column holds the evidence and the side column holds the context. The map panel keeps its own one-column body. The `/palette` entry for `<EventShell>` renders the three zones with every slot a labelled empty box, for each of the three fillings.

Each surface fills the slots this way:

| Slot | Event, version and request pages | Edit form | Submit form |
|---|---|---|---|
| Back | Back through the history | Back through the history, the row's page as the fallback | Back to the chooser (`onBack`) |
| `title` | The event title | **Edit geolocation**, **Publish detection**, **Edit request** or **Geolocate request**, a hidden `h1` and the browser tab's title | **Submit**, a hidden `h1` and the browser tab's title |
| `titleField` | None | The **Title** field | The **Title** field |
| `byline` | The author and the geolocators; on version 0, who opened the request or the detection | The geolocators, the pending invitations and **Invite a geolocator** on a published row; you, your picks and **Invite a geolocator** on a request or a detection | You, your picks and **Invite a geolocator** |
| `actions.pinned` | The actions row, **Geolocate** on a request, the version selector on a version page | The writes and the close ([`PublishActions`](../frontend/src/components/geolocations/PublishActions.tsx)), the error banner | The two publish buttons ([`PublishActions`](../frontend/src/components/geolocations/PublishActions.tsx)), the error banner |
| `actions.below` | The approvals and an invitation, a version's approvals | `IncompleteFormAnnouncer`, visually hidden | `IncompleteFormAnnouncer`, visually hidden |
| `panels` | The report form, a dialog, and the receipt a sent report leaves; the version banner | None | None |
| `sources`, `proof` | The source blocks, the proof | The source editors, the proof editor | The source editors, the proof editor |
| `location` | The map and its **Coordinates** row, none on a request | The **Location** field, its **Coordinates** label and `?` | The **Location** field, then the duplicate probe |
| `details` | The Details card | The **Details** fields | The **Details** fields |

- **Title section.** The title section heads the main column: back, the title, then the byline. The three pages share one top: on a form the **Title** field (`titleField`) takes the event title's place, in the title's size, weight and line height. The field takes the title's type (`PAGE_TITLE_TEXT` in [`PageShell.tsx`](../frontend/src/components/ui/PageShell.tsx)), and the typed text starts where the title's text starts: the box bleeds left by its border and padding (13px) and up and down by 5px, so the header keeps the title's height. The field is a one-row textarea that grows a row per wrapped line (`field-sizing: content`), so a long title wraps on a phone like the event title. Enter adds no line: on the edit form it saves, as Enter in a field does. The field stops at `EVENT_TITLE_MAX_LEN` characters. Its label is visually hidden, and a `<CharCounter>` then its `?` follow it. The form's page name stays the page's `h1`, visually hidden, and names the browser tab (*Submit on Vidit*). On a form the byline manages the geolocators in place, on one line, and nothing opens in the page (see [The owner edit form](#the-owner-edit-form)). Both bylines draw the co-geolocators as one `<AvatarStack size="sm">` after the lead at one gap (`BYLINE_GAP` in [`AuthorByline.tsx`](../frontend/src/components/ui/AuthorByline.tsx)), and the add button stays within the line, so the byline has the same height and the same picture positions on the page and on a form.
- **Actions block.** The actions block heads the side column, level with the title. Its pinned row, `actions.pinned`, holds the buttons, in an `aside` named *Actions* that `PageShell` renders around every `stickyActions`, and only the buttons, their counts and a form's error banner, so the pinned cluster stays one line. What reads under it, `actions.below`, scrolls with the page (see [Event actions and approvals](#event-actions-and-approvals)).
- **Pinned row.** From `lg` up the cluster is no wider than the side column and ends on its right edge. When the page scrolls, the title scrolls away and the cluster stays pinned at the top right of the column, so a write stays one click away from any field.
- **Between the zones.** `panels` take the full width between the title section and the body. A redacted version renders its banner and an `<EmptyState>` there and no `body`.
- **Main column.** The sources row, then the proof. One source takes the whole row (see [Source blocks](#source-blocks)).
- **Eyebrows.** `EventLayout` heads every section with its `<SectionEyebrow>`, from one table, `EVENT_SECTIONS` (the title and the `?` concept of the sources, the proof, the location and the details). The map panel reads its compact `h3` titles from the same table. A slot passes `{ content, invalid, aside }`: the card under the eyebrow, whether a publish flagged the section (the eyebrow turns red), and a node beside the eyebrow (the form's **Methodology guide** link beside **Proof**). The sources row heads itself (`<SourcesRow>`).
- **Cards.** Every card of the body takes the reading density, `<Card dense>` (`p-4`), on the page and on a form, so a field sits where its row reads.
- **Side column.** `location`, then `details`. On a form, Details is one card in the event page's order: the event date and time, the locked provenance link of an imported row, then the conflict and the tags. A form's Location and Details eyebrows turn red with the fields a publish flags in them, like the Sources and Proof eyebrows.
- **Form.** `EventLayout` renders a form's `<form>` as `display: contents` around the columns, so it adds no box. The title section and the actions block sit outside it: the **Title** field and the writes join it through its `id` (the `form` attribute). The version note is asked for in a panel on **Save version N**, which hands it to the write.
- **Details.** The Details card carries no Author row: the byline in the header credits the author and every geolocator.
- **Level tops.** On every surface the sources and the first block of the side column start at one height: the Location module, or the Details card when the event has no location. The sources row's header is always as tall as the scroller's 32px buttons (`min-h-8`), so `EventLayout` sets `<SectionEyebrow besideScroller>` on the side column's first eyebrow, which takes a row of the same height.
- **Narrow side column.** The event date and time share one line at every width, the side column and a 320px phone included: two shrinking columns, each field taking half the room. The coordinate pair keeps one line in the side column too (see [`CoordinateInputs`](../frontend/src/components/geolocations/CoordinateInputs.tsx)).
- **Below `lg`.** One column, in DOM order: the pinned row, the title section, `actions.below`, `panels`, the sources, the proof, the location, then the details. The pinned row takes the title row's right end when both fit, and the line above the title when they do not.

`PageShell` pins the actions with a sticky track, a spacer and a sentinel:

```mermaid
flowchart TB
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff
  classDef pinned fill:#f3e8fb,stroke:#7a4aa5,color:#4f2f6b
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a

  subgraph legend [Legend]
    direction LR
    l1["`the content column`"]:::core
    l2["`what the reader sees`"]:::pinned
    l3["`invisible, zero height or measured`"]:::spec
    l1 ~~~ l2 ~~~ l3
  end

  column["`**PageShell** content column
  relative, the page's full height`"]:::core
  sentinel["`**sentinel**
  marks the cluster's resting top`"]:::spec
  track["`**sticky track**
  zero height, top-10, top-16 below sm`"]:::spec
  cluster["`**the cluster**
  stickyActions; a surface once data-stuck`"]:::pinned
  spacer["`**spacer**
  the cluster's measured size, in the header`"]:::spec
  header["`**header**
  title row, or headerSide's top from lg`"]:::spec

  column --> sentinel
  column --> track --> cluster
  column --> header --> spacer
  cluster -. ResizeObserver .-> spacer
  sentinel -. compared on scroll .-> cluster
```

- **Track.** The cluster hangs from a zero-height `sticky` track placed before the header, so it stays pinned until the end of the page. Its `top` is the frame's top padding (`top-10`, `top-16` below `sm`), so it never moves before it pins, and it clears the menu chip on a phone. The track lets clicks through and sits inside the content column, never over the sidebar or the corner **Beta** badge.
- **Room.** The cluster floats over the header, so the header keeps its room: a spacer of the cluster's measured size (a `ResizeObserver`) at the title row's right end, or from `lg` up on a `headerSide` page at the top of the side column. The title row wraps upwards (`flex-wrap-reverse`), so on a phone the spacer takes the line above the title, where the cluster rests.
- **Surface.** At rest the cluster has no surface. Once it leaves its resting top (a zero-height sentinel marks it), it takes the page background, a border and a shadow (`data-stuck`), so the content scrolling under it stays out of the way. The surface overhangs by 8px, so the controls keep their edges.
- **Order.** The cluster comes after the back arrow and before the title in the DOM, which is also the tab order: the writes are the first stop on a form.

#### Event actions and approvals

The top right of the page is where you act on an event; the rest of the page is what you read. The event page puts its actions block there: a row of icon controls (the actions row), pinned, then the approvals of a published event and a pending geolocator invitation under it. The request page pins the same row there, then **Geolocate**. The title and the byline head the main column and carry no controls. [`useEventActions`](../frontend/src/components/event/useEventActions.tsx) assembles the controls and returns two values: the actions block for `EventShell`'s `actions` (`pinned`, the row and **Geolocate** on a request; `below`, the approvals and the invitation), and the panels the row's toggles open. A page renders those nodes instead of building controls of its own.

```mermaid
flowchart TB
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`what the reader sees`"]:::spec
    l2["`a shared primitive or component`"]:::shared
    l3["`the one place the controls are chosen`"]:::core
    l1 ~~~ l2 ~~~ l3
  end

  hook["`**useEventActions**
  picks the controls for the surface, the row and the reader`"]:::core

  subgraph header [Actions row, in order]
    direction LR
    versions["`**VersionSelector**
    v2, every version down to version 0, History`"]:::spec
    edit["`**Edit**
    the owner`"]:::spec
    share["`**Share**
    every reader`"]:::spec
    collect["`**Add to collection**
    the owner and co-geolocators`"]:::spec
    credit["`**Geolocators**
    a co-geolocator`"]:::spec
    ask["`**Request approval**
    a geolocator of a published row`"]:::spec
    report["`**Report**
    every reader but the owner`"]:::spec
    versions ~~~ edit ~~~ share ~~~ collect ~~~ credit ~~~ ask ~~~ report
  end

  menu["`**ActionMenu**`"]:::shared
  copy["`**CopyButton**
  through ShareControl`"]:::shared
  tooltip["`**Tooltip**
  on every icon control`"]:::shared
  editpage["`**/events/{id}/edit**
  Geolocators and the close`"]:::spec
  popover["`**Popover**
  floats over the page, takes focus when it opens`"]:::shared
  invite["`**GeolocatorInviteCard**
  actions block, under the row, for an invited analyst`"]:::spec
  approvals["`**Approvals**
  actions block, under the row, no card`"]:::spec
  dialog["`**ConfirmDialog**
  the open requests and the picker, the report form`"]:::shared
  geolocate["`**Geolocate**
  request page: under the row, pinned with it, opens the edit form`"]:::spec

  hook --> header
  hook --> approvals
  hook --> invite
  hook --> geolocate
  menu --> versions
  copy --> share
  tooltip --> header
  edit --> editpage
  collect --> popover
  credit --> popover
  ask --> dialog
  report --> dialog
```

The actions row holds these controls, left to right, each shown only to the reader it names. The pinned block reads in the *Actions* landmark `PageShell` renders, the forms' writes and a version page's selector included. The version selector's trigger is as tall as the 32px icon buttons beside it. It sits top right, level with the title, and ends on the side column's right edge from `lg` up. It stays pinned there while the page scrolls (see [Event layout](#event-layout)). On a phone it takes the line above the title, right-aligned, when the title row cannot hold both.

| Control | Who sees it | What it does |
|---|---|---|
| Version selector | Every reader of a published record, retraction included, on the event page and on a version page | A compact *v2* button with a chevron, an [`<ActionMenu>`](../frontend/src/components/ui/ActionMenu.tsx). It opens a list of the event's versions newest first, each named like the button (*v2*, *v1*), then **History**. Version 0, the request or the detection the event was published from, is named *Request* or *Detection*, on the button and in the list. The live version opens `/events/{id}`, an older one `/events/{id}/vN`, and **History** opens `/events/{id}/history`. The version on screen takes the active-row paint and focus when the menu opens. A list of *vN* entries is as wide as the button (`matchTriggerWidth`), and its **History** shows as its icon alone, named *History* with a tooltip, since the word and the icon do not fit a *vN* button's width; a list with a version 0 entry takes the menu's own width and names **History** in full. It shows on a single-version event too, so the version on screen is always named. |
| Edit | The owner of a row that is not closed; on the request page, the asker | An icon link (lucide `SquarePen`) named *Edit* to `/events/{id}/edit`. Its tooltip reads *Edit (saves a new version)* on a published row, which an edit corrects by adding a version. The owner closes the row and manages its geolocators there (see [The owner edit form](#the-owner-edit-form)). |
| Share | Every reader | One click shares. See **Share** below. |
| Add to collection | The owner and every co-geolocator of a row a collection may hold | A [`<Popover>`](../frontend/src/components/ui/Popover.tsx) (lucide `Layers`) whose panel holds the collection picker, anchored under the button (see [Collections](#collections)). |
| Geolocators | A co-geolocator of a published row | A [`<Popover>`](../frontend/src/components/ui/Popover.tsx) (lucide `Users`) whose panel holds the Geolocators list, where they leave. |
| Request approval | A geolocator of a published row (the owner or a co-geolocator), on the event page | An icon button (lucide `ClipboardCheck`) that opens a dialog to ask an analyst or an organization to approve the live version. See **Approval requests** below. |
| Report | Every reader but the owner, signed out included | The red flag ([`useReportContent`](../frontend/src/components/report/useReportContent.tsx)) that opens the report form, a [`<ConfirmDialog>`](../frontend/src/components/ui/ConfirmDialog.tsx) holding the reason `<Select>` and the details `<Textarea>`, each label with its `?` (`report_reason`, `report_details`). Once a report lands, the receipt takes the flag's place at the top of the main column. Reporting your own event says nothing an edit or a close could not. |

[`VersionSelector`](../frontend/src/components/event/VersionSelector.tsx) lists the versions from the live version number and the event's `version_zero`, so it reads nothing. It is not an owner control: the other controls act on the record, and this one reads it. Every reader gets it, because a corrected record is auditable only when anyone can walk the corrections. The map panel and the forms show one version by construction and carry none.

**Geolocate.** The request page renders its actions like the event page, with no card around them: the actions row (Edit for the asker, Share, Report), then **Geolocate** under it, the one filled button, aligned to the same right edge and pinned with the row, which opens the [edit form](#the-owner-edit-form) on the request, with a `?` saying what publishing does. On a phone the `?` keeps its tap area inside the row's right edge. A closed request keeps its row and has no **Geolocate**.

A popover's button wears the active-row paint while its panel is open. The panel floats over the page, fixed to the viewport, so opening it moves nothing. It takes focus when it opens, so a keyboard or screen reader user lands in it. Escape closes it and returns focus to the button; an outside click closes it. The report receipt is the one node the actions row adds to the page: it takes the top of the main column once a report lands. Nothing in the actions row closes or destroys a row.

**Share.** [`ShareControl`](../frontend/src/components/share/ShareControl.tsx) shares in one click, with no menu. Where the browser has the Web Share API (`navigator.share`), **Share** opens the device's share sheet with the event's address and title. Elsewhere it copies the address, and the confirmation is [`<CopyButton>`](../frontend/src/components/ui/CopyButton.tsx)'s, the app's one copy confirmation: the share mark turns into a check and fades back after 1.5 s, and *Link copied* reaches screen readers through a live region, with no visible text. [`EventShare`](../frontend/src/components/event/EventShare.tsx) passes the event's address and title. A `detected` row is still editable by its owner, so its share takes a confirming second click, with *Detected and may still change. Click again to share.* beside the button. The collection page keeps its own Share on X button (see [Collections](#collections)).

**Shared credit.** The Geolocators panel (`GeolocatorsPanel` in [`useEventActions.tsx`](../frontend/src/components/event/useEventActions.tsx)) lists the event's geolocators, owner first. A co-geolocator opens the list from the event page's actions row, with a **Leave** button on their own row. **Leave** is red and arms in place ([`useConfirmAction`](../frontend/src/hooks/useConfirmAction.ts)): the first click turns the button into its confirm (*Confirm leave*) with `DANGER_CONFIRM`, and the second writes. The owner manages the geolocators from the edit page's byline instead (see [The owner edit form](#the-owner-edit-form)). An analyst the owner invited reads a **Geolocator invitation** card in the event page's actions block instead, under the actions row, with **Accept** and **Decline** ([`GeolocatorInviteCard`](../frontend/src/components/event/GeolocatorCredit.tsx)); the invitation's notification links to the event page. Every byline of the event credits every geolocator.

**Approvals.** A published event's approvals of its live version sit in the actions block, under the actions row's resting place, on the page background with no card. They scroll with the page; the row stays pinned. A geolocator asks for approval from **Request approval** in the actions row. Outdated approvals are read on each version's page, which the version selector opens.

```mermaid
flowchart LR
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`what the reader sees`"]:::spec
    l2["`a shared component`"]:::shared
    l3["`the read behind them`"]:::core
    l1 ~~~ l2 ~~~ l3
  end

  read["`**GET /events/{id}/approvals?all_versions=true**
  every version's approvals and viewer_can_approve`"]:::core
  hook["`**useEventActions**
  fetches once`"]:::shared
  card["`**useEventApprovals**
  the live version only, the summary and Request approval`"]:::shared
  stamps["`**ApprovedBy** through **AvatarStack checked**
  every stamp with an accent check, no label, no count`"]:::spec
  page["`**Profile or organization page**
  each stamp links there, who approved which version when in a Tooltip`"]:::spec
  own["`**YourOutdatedApproval**
  You approved v1. Changed since: Title`"]:::spec
  approve["`**ApproveButtons**
  Approve, Approve as each of your organizations`"]:::spec
  confirm["`**Confirmation step**
  names the version, says the approval is final, then sends it`"]:::spec
  requests["`**ApprovalRequests**
  who asked you and Decline beside Approve, a geolocator's Request approval dialog`"]:::spec
  remove["`**Delete on a stamp**
  site admin, opens a ConfirmDialog`"]:::spec
  vn["`**VersionApprovals** on /events/{id}/vN
  that version's stamps, under the version selector`"]:::spec

  read --> hook --> card
  card --> stamps
  card --> own
  card --> approve
  card --> requests
  stamps -->|"click"| page
  stamps -->|"site admin"| remove
  approve -->|"click"| confirm
  own -->|"v1 link"| vn
```

- **Layout.** [`useEventApprovals`](../frontend/src/components/event/EventApprovals.tsx) returns two nodes over one read of the approval requests: the summary, and **Request approval** for the actions row. The summary, a `<section>` named *Approvals*, is in `actions.below` of `useEventActions`: it reads in the actions block, under the room the actions row keeps, on the page background with no card and no border. From `lg` up it aligns to the side column's right edge, under the right-aligned row. On a phone it follows the title. It renders nothing when the live version has no approval and the reader has nothing to act on (no **Approve**, no request, no outdated approval of their own).
- **Stamps.** [`ApprovedBy`](../frontend/src/components/event/Approvals.tsx) shows the stamps with no label and no count: the page never prints how many approvals an event holds. [`ApprovalStamps`](../frontend/src/components/event/Approvals.tsx) renders the live version's approvals (those that existed at closing, on a closed event) as an [`<AvatarStack checked>`](../frontend/src/components/ui/AvatarStack.tsx) named *Approved by* for screen readers: every stamp, 28px pictures set apart (`spacing="gap"`), oldest first, wrapping onto further lines, with no **+N** bubble. Each picture carries an accent check badge on its bottom-right corner. An analyst's approval shows the reviewer's picture in a circle, or the `<Avatar>` initial without one. An organization's approval shows the organization's picture in a rounded square. Each stamp is a link to the reviewer's profile or the organization's page. Its name, which a [`<Tooltip>`](../frontend/src/components/ui/Tooltip.tsx) shows on hover, on keyboard focus or on a first tap on a touch screen, says who approved which version when: *maya approved v2 on 15 Oct 2026*, or *Open Source Watch (maya) approved v2 on 15 Oct 2026* for an organization, without the member once that account is erased. A `?` ends the row on the last stamp's line (the `approval` concept), and from `lg` up every line of stamps aligns right: an approval means an analyst or an organization checked the geolocation and agrees with it, it covers one version, and it is final. While the live version has no approval, the `?` sits beside **Approve** instead, and shows only with it.
- **Your outdated approval.** A reader whose own approval covers an earlier version reads one line above **Approve**: *You approved v1. Changed since: Title, Proof.* ([`YourOutdatedApproval`](../frontend/src/components/event/Approvals.tsx), the version history's own `changedFields` through `changesSince`). The version links to its page.
- **Approve.** A secondary **Approve** shows only to a reader who may approve: the API's `viewer_can_approve` is true, so a former geolocator never sees a button the API refuses, and `canApprove` finds no approval of the live version by the reader, or by an organization they are a member of (`approveOptions` in [`lib/approvals.ts`](../frontend/src/lib/approvals.ts)). [`ApproveButtons`](../frontend/src/components/event/Approvals.tsx) has a leading `Stamp` icon and sits beside one **Approve as <organization>** per organization the reader is a member of, whatever their role, that has not approved the version ([`useMemberOrganizations`](../frontend/src/hooks/useMemberOrganizations.ts)). An approval is final, so a click opens a confirmation step, a [`<ConfirmDialog>`](../frontend/src/components/ui/ConfirmDialog.tsx), before anything is sent. The step names the version, names the organization when there is one, and says that the approval is final. The approval is sent only when the reader confirms, and **Cancel** sends nothing. A `version_mismatch` refusal prints the error with a **Reload** button, since the live version moved on since the page loaded. The new stamp is the confirmation: no banner follows an approval. **Approve** sits on its own line under the stamps, and no reader can withdraw an approval.
- **Admin deletion.** For a site admin (`useAdmin`), each stamp carries a delete control on its top-right corner: the `remove` disc of `<AvatarStack>`, revealed on hover or keyboard focus, named *Delete approval by <signer>*. It opens a [`<ConfirmDialog>`](../frontend/src/components/ui/ConfirmDialog.tsx) that names the version and the signer, says the deletion cannot be undone and says the reviewer can approve again. Confirming calls [`DELETE /admin/approvals/{approval_id}`](api.md#delete-adminapprovalsapproval_id) and refetches the list, and **Cancel** sends nothing. An `approval_not_found` refusal prints *This approval no longer exists* inside the dialog, which stays open. No other reader sees the control.
- **Approval requests.** [`ApprovalRequests.tsx`](../frontend/src/components/event/ApprovalRequests.tsx) serves the requests. A geolocator of a published event, the one reader who can send a request (`canRequestApproval`), gets **Request approval** in the actions row (`RequestApprovalAction`). It opens a [`<ConfirmDialog>`](../frontend/src/components/ui/ConfirmDialog.tsx) titled *Request approval* that holds the open requests under **Open requests** (who is asked, by whom and since when, or *No open requests.*), then an `<AccountPicker>` to pick whom to ask. **Cancel** takes the initial focus, and the list opens when the field takes focus. The list holds the analysts and organizations the server suggests; an exact username or slug the server leaves out shows the reason as the list's muted row, and a send error prints inside the dialog and clears once the query changes. The confirm button reads *Ask for approval* and stays disabled until a target is picked (`confirmDisabled`), then reads *Ask <name>*. Sending a request closes the dialog and rereads the open requests. An analyst asked, or any member of an organization asked, reads who asked just above **Approve**, with no heading of its own ([`IncomingRequests`](../frontend/src/components/event/ApprovalRequests.tsx)): one line holds the requesters' pictures and names side by side, each linked to the profile, then *asked for your approval*. A request to an organization reads *maya asked Open Source Watch for approval*, with the organization's logo and a link to its page. A ghost **Decline** sits beside **Approve** and declines every request addressed to the reader; its tooltip says the requester is notified. An approval refetches the requests, since it resolves the reader's own.
- **Filed versions.** A filed version's page (`/events/{id}/vN`) pins the version selector in its actions block, then reads that version's approvals under it in the same compact form ([`VersionApprovals`](../frontend/src/components/event/Approvals.tsx)): the checked stamps and the `?`, read-only, with a site admin's delete control on each stamp (see **Admin deletion**). The page shows nothing there when the version held none.

A notification carries no action. Each notification row links to the screen where you act: an approval request or a re-approval request to the event page, whose approvals hold **Approve** and **Decline**; a co-geolocator invitation to the event page, whose **Geolocator invitation** card holds **Accept** and **Decline**; an organization invite to the organization page, whose invite answer holds **Accept** and **Decline**. An answered request's row adds *Approved* or *Declined* to its label. Each row is a `<LinkRow variant="arrow">`: its delete control is a [`<RemoveButton>`](../frontend/src/components/ui/RemoveButton.tsx) inside the block, left of the arrow, a red cross since the removal is instant, named *Delete notification*, that deletes the row ([`DELETE /notifications/{id}`](api.md#delete-notificationsid)), and reloads the list and the sidebar dot. At 375px the sentence wraps and the trash and the arrow keep their place at the right edge.

**One verb closes every shape.** The verb is *Close*, and only the noun changes with the row: *Close this request*, *Close this detection*, *Close this geolocation* ([`CloseEventDialog`](../frontend/src/components/event/CloseEventDialog.tsx) holds that copy, and the edit page's menu item, the dialog's title and its confirm button all read it). One write ends all three, so one word names it on every surface. What the close means still differs by row, and the record says so: the closed page carries the reason, and the state it left is *withdrawn*, *rejected* or *retracted*. The close lives in the pinned row of the owner's edit page, a red trash button beside the save, not in the event page's actions row. A closed row has no edit page and no close: closing is terminal and the owner has no un-close. The dialog asks for a reason, and the reason's `?` says it stays public, because that reason is what a reader finds on the closed page in place of the claim.

A retracted geolocation keeps its page. It reads as a `Closed` badge with the reason and the closing day beside it, over the record it took back: the coordinates, the evidence, the credits and the version history are all still there, and the version selector stays in the actions row, since walking what the record used to claim is exactly what a reader does after a retraction. The map's side panel and the forms carry no actions row at all. The panel previews a row whose own page is one click away on the title, so acting on the record belongs there rather than in a preview of it; a form's primary action is its own Publish or Save, in the sticky actions over the fields it applies, and sharing or reporting a row one is in the middle of rewriting acts on a record that is not the one on screen. A review pass adds its own controls to the detection form's sticky actions instead (the queue position and Skip).

A published event names its version in the actions row's version selector, not beside the byline (see [Event actions and approvals](#event-actions-and-approvals)).

#### The owner edit form

```mermaid
flowchart LR
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`a row state and who edits it`"]:::spec
    l2["`what the form shows`"]:::shared
    l3["`the write`"]:::core
    l1 ~~~ l2 ~~~ l3
  end

  request["`**requested**, version 0
  anyone; the asker also saves and closes`"]:::spec
  detection["`**detected**, version 0
  the owner`"]:::spec
  published["`**geolocated**, version 1 and up
  the owner`"]:::spec
  publish["`**Publish**, arming
  CountBadge of the missing publish floor`"]:::shared
  save_request["`**Save request**
  the asker only, stays version 0`"]:::shared
  save["`**Save version N**
  the Version note in its popover, the geolocators byline`"]:::shared
  versions["`**POST /events/{id}/versions**
  files the version it supersedes`"]:::core
  request_write["`**POST /events/{id}/request**
  overwrites in place`"]:::core

  request --> publish
  request --> save_request --> request_write
  detection --> publish
  published --> save
  publish --> versions
  save --> versions
```

The locked provenance field (`detected_from_url`) carries the label the detail page gives the same link, from one helper (`provenanceLabel` in [`lib/events.ts`](../frontend/src/lib/events.ts)): *Requested from* on a row the bot opened as a request (`requested_by` set, which survives fulfilment), *Detected from* otherwise. Every shape of the form reads it.

[`<EventEditForm>`](../frontend/src/components/geolocations/edit/EventEditForm.tsx) is one form in two shapes, selected by the row's state rather than by a prop, so `/events/{id}/edit` is one address for the publish and for every correction. Both write through [`POST /events/{id}/versions`](api.md#post-eventsidversions) and post the version the form was loaded at, so a row that moved meanwhile answers a conflict instead of being overwritten.

On a `requested` or `detected` row, version 0, it is the publish form: every field editable, and a **Publish** that counts the publish requirements still missing, the count dropping as the form fills, and that arms in place, because publishing makes the row public as version 1. A detection is **Publish detection** and its owner's alone. A request is anyone's to publish: an analyst answering it reads **Geolocate request**, and the asker reads **Edit request** with a **Save request** beside **Publish**, which overwrites the open request in place at version 0 on the request floor alone. A published request opens its event page.

On a `geolocated` row it is **Edit geolocation**: the same field bricks and the same editable fields, every source included, and a **Save version N** whose first click asks for an optional **Version note** in a popover and whose confirm writes, because a version adds a version and overwrites nothing. The button names the number it would produce, so the reader sees what they are about to create rather than what is on screen. A save that would move no versioned field is refused in the form, without a request: the banner reads *Nothing changed since version N*, which is the sentence the server's own refusal maps to. Some inputs hold less than their column does, a link's post time and a source's capture time (minutes) and the event time (no seconds), so a field still holding what the row seeded it with is treated as untouched and goes back at the row's precision rather than as its own truncation. Otherwise every edit of a typo would quietly take the seconds off a published record, and no save would ever count as unchanged.

**The owner's management lives on the edit page.** The event page's actions row carries only **Edit** for the owner; what the owner does to the record beyond correcting it sits on the edit page: the close, a red trash button in the pinned row, and the geolocators in the title section's byline.

```mermaid
flowchart TB
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`the layout primitive, thick-bordered`"]:::core
    l2["`a region of the edit page`"]:::spec
    l3["`a shared component`"]:::shared
    l1 ~~~ l2 ~~~ l3
  end

  shell["`**EventFormShell** on **EventShell**
  the title section, the actions block, the body`"]:::core
  layout["`**EventLayout**
  eventFormSlots: the fields in the body`"]:::core

  subgraph titlesection [Title section]
    direction TB
    title["`**Title** field, in the title's place, outside the form
    the page name, Edit geolocation, a hidden h1`"]:::spec
    byline["`**Byline**, one line: GeolocatorsByline or useDraftGeolocatorsByline
    a published row: invite, withdraw, remove, each on click
    a request or a detection: the picks the publish invites`"]:::spec
    title --> byline
  end

  subgraph rail [Actions block: pinned row]
    direction TB
    queue["`**Queue position and Skip**, a review pass only`"]:::spec
    actions["`**PublishActions**: Save version N, or Publish and Save request
    then the close`"]:::spec
    count["`**CountBadge** on Publish and Save request
    the missing requirements, an unpublished row only`"]:::shared
    banner["`the error banner`"]:::shared
    popover["`**Popover** on Save version N
    the Version note, Save version N`"]:::shared
    close["`**Close**, a red trash button
    Close this geolocation, detection or request`"]:::shared
    dialog["`**CloseEventDialog**
    the reason, Cancel, the close`"]:::shared
    queue --> actions --> banner
    actions --> count
    actions --> popover
    actions --> close --> dialog
  end

  note["`**actions.below: IncompleteFormAnnouncer**
  visually hidden, read to a screen reader`"]:::spec

  subgraph side [Body: side column]
    direction TB
    location["`**Location**`"]:::spec
    details["`**Details**`"]:::spec
    location --> details
  end

  shell --> titlesection
  shell --> rail --> note
  shell --> layout --> side
```

- **The form.** [`EventFormShell`](../frontend/src/components/geolocations/EventFormFields.tsx) renders an event form on [`EventShell`](#event-layout), the submit form's too: `eventFormSlots` places the event fields in its zones (the **Title** field in the title's place in the title section, the other fields in the body), the writes pin in the actions block with the hidden `IncompleteFormAnnouncer` under them, and the body's `<form>` is `noValidate`. A form passes its title, byline, writes, `formId` and `onSubmit`, and wires none of these. The page's `<form>` holds the body fields and nothing else. The **Title** field and the submit button in the pinned row sit outside the form and join it through its `id` (the `form` attribute), so Enter in a field or in the **Title** field still saves.
- **Pinned row.** [`PublishActions`](../frontend/src/components/geolocations/PublishActions.tsx), the submit form's too: in the *Actions* landmark: a review pass's position and **Skip**, then one right-aligned line: the write, **Save version N**, or the arming **Publish** (it reads *Confirm* with `ARMED_RING`, in the room its label keeps, so arming never widens the line, and its armed sentence reaches screen readers through a live region) with, for the asker of a request, **Save request**, then the `?` of a publish (`action_publish`), then the close for the owner. On a request or a detection, **Publish** and **Save request** each carry a [`<CountBadge>`](#build-on-shared-primitives) of the requirements still missing, the publish floor and the request floor, and dim while short; the list shows on hover, on keyboard focus, or on a tap on the count. Each button shows its icon from `lg` up. Under the line, the error banner, `role="alert"`. The hidden `IncompleteFormAnnouncer` sits in `actions.below`.
- **Close.** For the owner, a red `<RemoveButton confirms>`, a trash since it asks first, ends the line, named and tooltipped **Close this geolocation**, **Close this detection** or **Close this request**. It opens [`CloseEventDialog`](../frontend/src/components/event/CloseEventDialog.tsx), a `ConfirmDialog` that says what closing does, then asks for the reason. A close lands on the event page, the next detection of a review pass, the detections queue, or the request page for a request.
- **Version note.** On a published row, the first click on **Save version N** runs the checks, then opens a [`<Popover>`](../frontend/src/components/ui/Popover.tsx) panel anchored to the button: the optional **Version note** field with its `?` (`version_note`) and a `<CharCounter>` against `VERSION_NOTE_MAX_LEN`, then **Save version N**, which writes. Enter in the note writes too; Escape or an outside click closes the panel and writes nothing. The page body holds no note, so nothing pushes **Location** down.
- **Geolocators.** The title section's byline is one line and manages the geolocators in place, so nothing in the page moves: the owner, each co-geolocator as an [`<AvatarStack>`](../frontend/src/components/ui/AvatarStack.tsx) picture, each pending invitee as a faded (`muted`) picture whose tooltip reads *cy, invitation pending*, then **Invite a geolocator** (lucide `UserPlus`). That button is a [`<Popover>`](../frontend/src/components/ui/Popover.tsx): a small panel anchored under it, floating over the page, that holds only an `<AccountPicker>` (the author typeahead, or an exact username committed with Enter) and one line on what an invitation does. The field takes focus when it opens; Escape and an outside click close it. Each picture carries its remove disc. A pick of yourself, of an analyst already credited or invited, or past `MAX_EVENT_GEOLOCATORS` (you and the pending invitations included) is refused in the popover before any request.
- **Published row.** [`GeolocatorsByline`](../frontend/src/components/event/useGeolocatorsByline.tsx) applies each change on click through its own endpoint, and no change makes a version. A pick sends the invitation and closes the popover; a refusal prints in the popover, which stays open. The remove disc of a co-geolocator opens a [`<ConfirmDialog>`](../frontend/src/components/ui/ConfirmDialog.tsx) (*Remove bo?*), and the one of a pending invitee another (*Withdraw the invitation of cy?*); the write runs only on the confirm, and its refusal prints in the dialog. A change rereads the row.
- **Request or detection, and the submit form.** On a request or a detection, and on the [submit form](#forms), the byline is yours, since you own the event once it is published ([`useDraftGeolocatorsByline`](../frontend/src/components/event/useGeolocatorsByline.tsx)). Nothing is sent from it: a pick joins the byline as a faded picture (*dee, invited when you publish*), a refused pick prints in the popover, and the remove disc takes a pick back at once. **Publish** and **Publish geolocation** post the picks with the publish ([`geolocator_invites`](api.md#invitations-on-the-publish)), so a refused invitation publishes nothing and prints in the error banner. **Publish request** and **Save request** post none, and the popover's line says so.
- **Phone.** The pinned row takes the line above the **Title** field and stays pinned under the menu chip while the fields scroll. The title section follows: the **Title** field, then the byline. The side column follows the main column: Location, then Details.

#### The version history and one version

Three addresses read one record. `/events/{id}` is the canonical page and always shows the current version. `/events/{id}/history` lists every version. `/events/{id}/vN` shows the record as version N stood.

The page titles itself *Version history* and names the event under it as plain text: the `Current` row already opens the event, and a second way there in the header is one control the reader has to tell apart from the other.

**The list is one row per version, newest first.** A row states which version it is, what its edit changed, and who made that edit when: a neutral `v3` [`<Pill>`](../frontend/src/components/ui/Pill.tsx), or `Detection` or `Request` for version 0, an accent `Current` beside it on the live version, the changed fields as a short line (*Title, Coordinates, Proof*), then the editor's byline, the date and their note. The whole row is one click, the model every catalogue row uses: a past version opens its own address, and the current version opens `/events/{id}`, because that is where the record as it stands is read. The byline is [`<AuthorByline link={false}>`](../frontend/src/components/ui/AuthorByline.tsx), the handle as plain text: an anchor under the stretched link is a target the mouse reaches by z-order and the keyboard reaches as its own stop, so the two would disagree about what the row does. The profile stays one tap away from the version the row opens. A version an admin redacted carries a danger `Redacted` pill and keeps its number, its byline and its link.

**A row is credited to the edit that produced it.** The API files that credit on the version the edit superseded, so version *n* takes its content from version row *n* and its byline, date and note from row *n - 1* ([`eventVersions`](../frontend/src/lib/events.ts)). Version 0 is the request or the detection the event was published from: it reads *Requested* or *Detected* and carries the asker, or the owner of a detection, and the date the row was opened. Version 1 was published rather than edited, so it reads *Published*; it takes its byline and date from row 0 when there is one, and otherwise carries the record's own author and publication date. The changed fields are computed on the client from the two adjacent versions, since the API serves what each version held rather than what an edit did, and they print under the names the event page already uses for the same values. Two versions that cannot be compared, a redacted one on either side, print nothing rather than an empty edit.

What version 0 was lives in one table, `VERSION_ZERO_META` in [`lib/events.ts`](../frontend/src/lib/events.ts): its name (*Request* or *Detection*), the status it reads with, the verb of its banner (*asked* or *imported*) and the field that credits it (`requested_by` or `owner`). The version selector, the history row, the banner and the version page read it, and the history row's *Requested* or *Detected* is that status's badge label.

**The list walks the shared cursor**, with [`<LoadMoreRow>`](../frontend/src/components/ui/LoadMoreRow.tsx) at the foot like every other cursor list. The page is 50 versions, half the shared row cap, so a history that reaches the 100-version ceiling still pages and the control is one the product exercises rather than one it only declares. A version's credit sits on the version below it, so the oldest row of an unfinished walk is credit for the row above it rather than a row of its own: it is held back until the next page completes it. A row is whole or absent, never a version number with no editor beside it.

**A version page is the canonical page minus its actions.** Both render [`EventShell`](#event-layout) filled by `eventPageSlots` and `eventLocation`, fed either the live row or a snapshot mapped onto the same shape (`snapshotToEventView`), so a version cannot drift into a layout of its own. Sharing, reporting and editing act on the record, so the header carries only the version selector, with this version marked. An amber [`<EventVersionBanner>`](../frontend/src/components/event/EventVersionBanner.tsx) opens the page (*Version 2 of 4, edited by ana on 18 Mar 2026*; on version 0, *The detection this event was published from, imported by ana*) with an orange link to the current version, the callout split every warning surface takes: the card is the caution, the clickable affordance stays the accent. A redacted version renders the banner and an `<EmptyState>` saying so in the shell's panels, and no body.

**`/events/{id}` stays canonical.** A version page carries `robots: noindex` and a canonical link to `/events/{id}`, and asking for the current version's own number forwards there rather than serving the record at two addresses. The route is a `[version]` segment beside the static `edit` and `history` ones, so a version keeps a one-segment address; a segment that is not `v` followed by a version number is a 404, as is a number past the current version and `v0` on an event with no version 0. Version 0 reads with the status it had, *Requested* or *Detected*, and its page carries no approvals, since nothing approves an unpublished row. Its byline credits who opened it, the asker of a request or the owner of a detection, as its history row does, not the event's credit today.

### Feed

```mermaid
flowchart TB
  classDef page fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff
  classDef state fill:#fdf3e7,stroke:#b8661a,color:#7a430f

  subgraph legend [Legend]
    direction LR
    l1["`feed page only`"]:::page
    l2["`shared list primitive`"]:::shared
    l3["`the server walk, thick-bordered`"]:::core
    l4["`what the reader sees`"]:::state
    l1 ~~~ l2 ~~~ l3 ~~~ l4
  end

  toggle["`**SegmentedControl**
  scope: Following (default) or All`"]:::page
  filters["`**filter rail**
  Kind and Show detections, Conflict, Source kind, Level, Tags`"]:::shared
  walk["`**useCursorList**
  one walk per scope and filter set; a change starts a new walk`"]:::shared
  api["`**GET /feed**
  scope, kind, conflict, source_kind, level, tag, limit 10, cursor`"]:::core
  cards["`**EntityCard variant=feed**
  one card per row, appended page by page`"]:::page
  row["`**LoadMoreRow infinite**
  useInfiniteScroll observes the row`"]:::shared

  empty["`**empty first page**
  filtered: boxed line; Following: no follows, or nothing posted; All: boxed line`"]:::state
  failed["`**failed page**
  cards stay, message above Try again; scrolling pauses`"]:::state
  done["`**end of the walk**
  You have reached the end of the feed`"]:::state

  toggle --> walk --> api
  filters --> walk
  api -->|first page| cards
  api -->|no rows| empty
  cards --> row
  row -->|within one screen| walk
  row -->|request fails| failed
  failed -->|Try again| walk
  api -->|no next page| done
```

`/feed` is a signed-in page, linked from the rail between Requests and Search. [`GET /feed`](api.md#get-feed) decides which rows it lists and in what order. `/timeline` redirects permanently to `/feed`.

**A [`<SegmentedControl>`](../frontend/src/components/ui/SegmentedControl.tsx) under the title picks the scope**, **Following** (default) or **All**. Picking an option starts a new walk with `scope`, so the list and its empty state describe the scope on screen.

**The [filter rail](#right-rail) narrows the walk.** The panel offers **Kind**, Conflict, Source kind, Level, Tags and Approvals, the filters `GET /feed` serves. A change starts a new walk with `kind`, `conflict`, `source_kind`, `level`, `tag` and the approval keys.

**Kind** holds two controls:

- The **Geolocations** and **Requests** chips narrow the feed to the kinds you select, and then it lists no detections.
- The **Show detections** [`<ToggleRow>`](../frontend/src/components/ui/ToggleRow.tsx) applies only while neither chip is selected. It is on by default, so the feed lists geolocations, requests and detections. Turned off, it hides the detections and adds a *Detections hidden* pill, which turns it back on when removed. While a chip is selected the switch is `disabled`, keeps its state, and its description says when it applies. The pill leaves with it.

The page sends no `kind` while no chip is selected and the switch is on. It names `geolocation` and `request` when the switch is off, and only the selected kinds when a chip is selected. The filters live in page state and reset on reload. A filtered view that matches nothing reads *Nothing in the feed matches the filters.* in the `boxed` empty state, instead of the follow prompts below.

**A card names its kind.** Each row is the `feed` [`<EntityCard>`](../frontend/src/components/ui/EntityCard.tsx), which only the feed renders. Read top to bottom, it holds:

1. The title, with the [`<StatusBadge>`](../frontend/src/components/event/StatusBadge.tsx) beside it, so *Geolocated*, *Requested* or *Detected* says what the row is.
2. The byline, which credits the row's owner as a picture and a name, then each co-geolocator as a picture. An open request's owner is its requester, and a detection's owner is the analyst whose post was imported.
3. The dates, each named: *Event 25 Aug 2009* when the event date is known, then *Published 3 Oct 2026* on a geolocation, *Requested 3 Oct 2026* on a request or *Detected 3 Oct 2026* on a detection (`feed_at`). The coordinates follow when the row has them.
4. The media.
5. The tag row from [`cardTags`](../frontend/src/lib/cardTags.ts). A conflict is a key/value [`<Pill>`](../frontend/src/components/ui/Pill.tsx) (`label`), for example *Conflict: Russo-Ukrainian war*. Free tags follow as plain pills. A card carries no source, so it names no source kind: the kind reads on the event page's [source blocks](#source-blocks).

A geolocation or a detection opens `/events/{id}` and a request opens `/requests/{id}`.

**An empty first page names its cause.** An unfiltered empty **Following** view reads the viewer's `following_count` from [`GET /users/{username}`](api.md#get-usersusername) to tell two cases apart:

| Case | Empty state | Actions |
|---|---|---|
| The viewer follows nobody | `invite`, *You follow no analysts yet* | **Show all activity**, **Explore the map** |
| The analysts followed have posted nothing | `plain`, *Nothing from analysts you follow yet* | **Show all activity** |

**Show all activity** switches the scope to **All**. An empty **All** view is a `boxed` line. A first page that fails shows its error banner alone.

**The list walks the shared cursor and scrolls without a click.** A page is 10 rows. [`useCursorList`](../frontend/src/hooks/useCursorList.ts) holds the walk, and the foot is [`<LoadMoreRow infinite>`](../frontend/src/components/ui/LoadMoreRow.tsx), the foot every cursor list shares. Its [`useInfiniteScroll`](../frontend/src/hooks/useInfiniteScroll.ts) calls `loadMore` when the row comes within one screen of the viewport, from the render that mounts the row. While the next page loads, the button is disabled and shows a spinner with *Loading…*.

**A failed page keeps the cards.** The error shows above the row, the button reads **Try again**, and scrolling stops loading until the click, since the row is still in view.

**The end of the walk is marked.** Once no next page exists, the foot reads *You have reached the end of the feed* in the `plain` empty state.

### Public profile

[`/profile/{username}`](../frontend/src/app/profile/[username]/page.tsx) is an analyst's portfolio, the page they pin as their link, so it reads as evidence rather than as an account: identity and contact in the header, then the work, widest reading first.

| Block | Component | Data source | Shown |
|---|---|---|---|
| Identity | `ProfileTitle`, `ProfileIdentity` ([`ProfileHeader.tsx`](../frontend/src/components/profile/ProfileHeader.tsx)), `LinkedAccountsLine` ([`LinkedAccounts.tsx`](../frontend/src/components/profile/LinkedAccounts.tsx)) | `GET /users/{username}` | Always |
| Organization logos | `ProfileOrganizations`, inside `ProfileIdentity` | [`GET /users/{username}/organizations`](api.md#get-usersusernameorganizations) | When the analyst belongs to one |
| Detections queue | `DetectionsEntry` | `useDetectionsCount` | Owner only, while the queue holds something |
| Coverage | `ProfileMap` | `GET /events/points?author=…` | When the analyst has located events |
| Insights | `ProfileInsights` | `GET /users/{username}/stats` | When the profile has events |
| Collections | `CollectionsSection` | [`GET /users/{username}/collections`](api.md#get-usersusernamecollections) | Owner always; visitor when the list is not empty |
| Recent submissions | `RecentSubmissions` | `GET /users/{username}/events` | Always |
| Sign out | | | Owner only, under all of it |

#### Identity

- The handle is the H1, with the avatar beside it (`ProfileTitle`), the grammar the event page uses. PageShell's `subtitle` slot carries `ProfileIdentity`: the bio, then the metadata line. One `space-y-1` spaces the block, so an empty bio leaves no gap. Edit mode drops the block.
- The profile never prints the account's email, even to its owner: the email is private account information, so it reads on the settings page, in the Account card beside the username.
- The bio has no card, so the evidence starts one glance below the handle. Empty renders nothing. Every http(s) URL in the bio links through `<OutboundLink>` (see [Outbound links](#outbound-links)) and breaks through `[overflow-wrap:anywhere]`; trailing sentence punctuation stays text. A long bio wraps rather than clamps, since `BIO_MAX_LEN` caps it at 500 characters. Authored line breaks collapse here and keep their shape in the edit field.
- The metadata line reads `N followers · N following · Member since <date>` as secondary text. It carries no work figures; those live in Insights. Each segment holds together, so the row wraps between segments at 375 px. Zero values print.
- The analyst's organizations close the metadata line as one more segment: their logos in an [`<AvatarStack>`](../frontend/src/components/ui/AvatarStack.tsx), each a rounded square (`variant="organization"`), every membership shown. Each logo is a link to `/organizations/{slug}` named "Member of <organization>" or "Org manager of <organization>", which its `<Tooltip>` shows on hover or keyboard focus; a click follows the link. On a touch screen the first tap shows the label and the second follows the link. The row wraps with the line on a phone. An analyst in no organization, or a failed read, shows no segment, so the coverage map is the first block under the header.
- The `actions` cluster carries the linked accounts, then Edit profile on your own profile, or Follow on someone else's. A failed follow prints its error in `FORM_ERROR_BANNER` under the button.

#### Linked accounts

- `LinkedAccountsLine` is a row of ghost icon buttons, one per platform the profile carries (X, Discord, website, GitHub), each the brand mark alone. Marks rather than printed handles keep the weight on the handle that titles the page.
- The owner's **Edit profile** is the last control in that row, a `Pencil` in the same square. The row's `gap-1.5` is the event page's action-cluster spacing, the cluster's `gap-2` separates the row from the button beside it, and the row wraps inside the cluster.
- The account is in each mark's `title` and accessible name (`X / Twitter: @analyst_example`), printed through `displayLinkValue` ([`lib/users.ts`](../frontend/src/lib/users.ts)): an X or GitHub value reads `@handle` whether stored as a profile URL or a bare handle, and a website drops its scheme and trailing slash.
- Each platform's `action` decides what its mark does, never how it looks. `link` opens the profile in a new tab through `<OutboundLink>`, so a website on an unknown host asks first. `copy` runs the mark over `useCopyToClipboard`; Discord takes it because the platform publishes no profile URL for a username. The mark flips to a check for the flash while its name holds still.
- `resolveLinkHref` links an X or GitHub value only when it names an account under the platform's own rules, and a website only when it parses as an http(s) URL. `PATCH /users/me` applies the same rules (see [`api.md`](api.md#patch-usersme)). A stored value the strict parse refuses renders nothing.
- A profile with no reachable account renders no marks, which leaves Edit profile or Follow alone.

#### Work blocks

- **Detections queue** (`DetectionsEntry`): the count of `detected` geolocations awaiting your submission, linking to `/profile/{username}/detections`. It sits above the work because it is pending work.
- **Coverage** (`ProfileMap`): the shared `<Map>` with an explicit world `bbox` (`WORLD_BOUNDS` through `toBboxParam`; the endpoint requires one), the camera fitted to the returned points. It maps `geolocated` and `detected` in the map's two point shades. The count beside the heading splits the same way ("N geolocated, N detected on the map"), so its `geolocated` leg equals the Insights `Geolocated` tile.
- **Insights** (`ProfileInsights`): see [Insights](#insights).
- **Collections** (`CollectionsSection`): a grid of mosaic cards, the turn from readings of the whole body of work to the work itself (see [Collections](#collections)).
  - Each card carries the mosaic, the title, the description's plain-text projection clamped to two lines, and the collection page's meta line, and the whole card is one click. No type mark sits beside the title, so the title keeps its two lines of width.
  - The endpoint narrows by viewer. On an empty list a visitor sees no section, and the owner keeps the heading and a first-run state that says the list is empty once and carries the action that fills it.
  - The grid holds four cards. Past four, `Show more` opens the shelf in `/search` through `profileSearchHref`, carrying `type=collection`, the one scope the `author` filter narrows instead of emptying.
  - Both owner entry points, beside the heading and in the first-run state, link to `/collections/new`.
- **Recent submissions** (`RecentSubmissions`): the five newest rows from an endpoint that serves published work only, so the block is what the analyst vouched for. It counts the same set as the `Geolocated` tile.
  - The heading copy and `Show more` key off the returned rows: an analyst with detections alone gets "No geolocations yet.", and `Show more` carries `status=geolocated` into `/search`.
  - Every visitor sees the same rows, the owner included. When the block is empty, a visitor gets the heading and "No geolocations yet.", and the owner gets the heading and an empty state that links to the submit form, so the block says it is empty once.
  - It reads last because it is the block that grows.

#### Insights

`ProfileInsights` is the page's only home for work figures: a `<StatGrid>` of four tiles (`Geolocated`, `Detected`, `Top conflict`, `Top source kind`), then the source-origin bar and the month grid. It sits under the map because it interprets it: the map says where, the card says what kind, how much, and when.

- **Every tile links into `/search`** through `profileSearchHref` ([`lib/search.ts`](../frontend/src/lib/search.ts)), the one builder for the profile's search links, both `Show more` links included. The status pair carries `status=geolocated` and `status=detected`, the leaders carry `conflict=` and `source_kind=`, and `author` is an exact username match, so a tile lands on the rows it summed. A tile takes `TAPPABLE_HOVER` plus a `focus-visible` ring.
- A leader with no value prints `None` and carries no link. The two counts stay linked at zero.
- A leader tile names who leads, and the search behind it says by how much. There is no `Media` tile; `media_count` is served and the share card prints it.
- **One population.** Every field counts visible `geolocated` and `detected` events. A `requested` or `closed` row counts in no figure: an open ask is not documented work, and a closed row is work the analyst discarded.
- The line under the card heading names that population for the tiles only (*The tiles below read one set of N events: this analyst's geolocations and machine detections. Two count it, two name what leads it*). Each chart states its own population in its own note, since neither draws the whole set.
- **Source origin** ([`<SourceHostBar>`](../frontend/src/components/ui/SourceHostBar.tsx)) is one stacked bar over the host of each event's first source URL, ranked, with a legend naming every slice. It says what kind of work the analyst does rather than how much.
  - Hosts are bare (`t.me`, not *Telegram*), the vocabulary `<SourceLabel>` uses, so the long tail is named rather than printed as "Unknown". The server folds the host to lower case and strips a leading `www.` (see [`api.md`](api.md#get-usersusernamestats)).
  - Five hosts name themselves, the ceiling the endpoint applies to the leader rankings. The rest is one *Other* slice, and events with no readable source are a *No source* slice, so the bar accounts for every event the tiles count.
  - The heading carries the source URL `<FieldHelp>`, which separates where a source was posted (the platform) from its kind (the lens or the document). One line under the heading states what the bar counts.
- **The month grid** ([`<ActivityHeatmap>`](../frontend/src/components/ui/ActivityHeatmap.tsx)) counts `occurred_date`: when the documented events happened.
  - The heading is *Event dates*, the field's name on the submit and edit forms. The line under it reads *The month each event took place, not when it was posted, imported or published*, since a calendar on a profile otherwise reads as posting activity. The same line states the grid's population (*It covers the N events dated in the years shown*), summed off the buckets rather than `total_events`. The `event_date` `<FieldHelp>` carries the field's definition.
  - One row per calendar year, twelve month cells, intensity off the busiest month, and a *Less / More* legend. Months rather than days, since tens of events a year leave a daily grid blank.
  - The server derives the span from the analyst's earliest and latest event date, not from today, so an imported multi-year archive reads whole. The grid shows the 10 most recent years, the rows the card holds at 375 px, and the year labels name them. Every month in the span renders, so a quiet stretch reads as empty. Both ends are clamped to today, so one mistyped year cannot move the window centuries out.
  - Hovering or tapping a month names it and its count in one readout line under the grid; there is no per-cell tooltip. The cells are paint, not controls: no focus stop, no focus ring. A lit cell carries the accent step its count earns, and an empty one carries `CHART_NEUTRAL`.
  - No dated event renders a sentence. A single month keeps the grid, since the empty cells say which month it was.

#### Edit mode

While the owner edits, the page renders only the header fields, `BioField`, and `LinkedAccountsFields`, contiguous and in reading order under the header. **Cancel** and **Save** leave the `actions` cluster for the page's sticky actions (`ProfileEditActions`), pinned at the top right while the fields scroll, with the save error under them. `BioField` and `LinkedAccountsFields` are each a `Card` headed by a [`<SectionHeading>`](../frontend/src/components/ui/SectionHeading.tsx). Each linked account is an [`<Input icon>`](../frontend/src/components/ui/Input.tsx) carrying the platform's mark, under a `FORM_LABEL` that names the platform. Both fields are edit-mode only, since reading the bio and the links happens in the header. The organization page's edit mode is the same. The metadata line, the linked-accounts marks, and the read-only sections drop out.

### Organization page

```mermaid
flowchart TB
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`a block every reader sees`"]:::spec
    l2["`a block one viewer sees`"]:::shared
    l3["`a profile primitive shared with the analyst profile`"]:::core
    l1 ~~~ l2 ~~~ l3
  end

  header["`**ProfileTitle**, **IdentityLines**, **ProfileActions**
  name, picture, bio, members and since, links, Edit`"]:::core
  edit["`**useProfileEdit** with organization calls
  **ProfileHeaderEditFields**, **BioField**, **LinkedAccountsFields**`"]:::core
  answer["`invite answer
  Accept, Decline`"]:::shared
  members["`**OrganizationMembers**
  **LinkRow** to each profile, role and removal controls`"]:::spec
  approvals["`**OrganizationApprovals**
  **LinkRow** to each event, version, reviewer, state`"]:::spec
  requests["`**OrganizationApprovalRequests**
  audience control, **LinkRow** to each event, Decline`"]:::shared
  invites["`**OrganizationInvites**
  mutual-follow picker, **LinkRow** to each invitee`"]:::shared

  header --> answer --> members --> approvals --> requests --> invites
  header -.->|Edit| edit
```

[`/organizations/{slug}`](../frontend/src/app/organizations/[slug]/page.tsx) is an organization's public page. It reads like the [public profile](#public-profile), so the header reuses the profile's primitives rather than a second set. Every list on the page is a stack of [`<LinkRow variant="arrow">`](#build-on-shared-primitives) blocks: a leading 28px `<Avatar>`, the title in neutral text, a muted `meta` line, and an orange arrow at the right edge. A row's controls sit in its `action` slot, so a click on them never follows the row. The page shows each viewer the controls their own membership grants: a site admin who is not a member reads it as a visitor and runs organization operations from the admin panel.

- **Header.** `ProfileTitle` takes the organization's name and picture. `IdentityLines` carries the bio and the metadata line (`N members · @handle on X · Since <date>`), the same block `ProfileIdentity` renders for an analyst. `ProfileActions` carries `LinkedAccountsLine` and, for an org manager, Edit.
- **Edit mode.** `useProfileEdit` takes the organization's three writes through `calls`, so the picture picker, the bio field and the linked-account fields are the profile's own.
- **Invite answer.** An invited viewer sees a card naming the organization with **Accept** and **Decline**. The `organization_invite` notification links here.
- **Members.** `OrganizationMembers` lists one row per member, linked to their profile: the avatar, the username, a meta line with a `<Pill>` for the role (accent for an org manager, neutral for a member) and the join date, and the controls the viewer holds. A manager flips the role and removes; every member leaves from their own row. Removing and leaving take the two-click `DANGER_CONFIRM`. The server's `last_manager` refusal shows as the row's error banner.
- **Approvals.** `OrganizationApprovals` lists the approvals placed in the organization's name, newest first, with **Load more** past a page: each row links to the event and leads with the acting member's avatar. Its meta line holds the version, the acting member and the date, and the event page's state pill (`ApprovalState`).
- **Approval requests.** `OrganizationApprovalRequests` shows to members. For an org manager, its first row is **Accept approval requests from**, the Settings row's `<ChoiceRow>` with the organization's labels (**People our org managers follow**, **Everyone**, **Nobody**), saved on change. Under it, the open requests addressed to the organization, oldest first: each row links to the event, leads with the requester's avatar, and says the version and who asked when. Every member gets **Decline** on each; approving happens on the event page, as the organization.
- **Search.** [`/search`](../frontend/src/app/search/page.tsx) finds an organization by name, slug or bio, with no navigation entry of its own. The **Organizations** option of the result type control carries the `Building2` glyph, and the group follows **Analysts**. Each hit is the analyst hit's row, `ProfileResult`: the picture, the highlighted name, a meta line tagged with `Building2` (`Organization · N members`), and the bio excerpt when the bio matched. The row links to the organization page. The page shows no filter rail on this scope, since every filter is an event predicate.
- **Invites.** `OrganizationInvites` shows to org managers. An org manager picks from the analysts the server accepts in an `<AccountPicker>`, with one line saying the list holds mutual follows only. Each pending invite is a row linked to the invitee's profile, with the invite date and who sent it, and withdraws with one ghost button in the row.
- **Deletion.** Only a site admin deletes an organization, from the admin panel's Organizations list (`OrganizationsPanel`), where each organization is a `<LinkRow variant="arrow">` to its page with its member count and, when it has no org manager, a danger pill and the field to name one under the row. **Delete**, in the row, opens a `<ConfirmDialog>` that says what goes with the organization and holds a field for its slug; **Delete organization** stays disabled until the typed slug matches.

### Collections

A collection is one analyst's named set of their own `geolocated` and `detected` events, shown on their public profile. Its two written fields, the title and the description, are both required. The items order themselves by event date, so there is no caption and no manual order.

```mermaid
flowchart LR
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`a surface a reader opens`"]:::spec
    l2["`a shared component`"]:::shared
    l3["`the endpoint behind it`"]:::core
    l1 ~~~ l2 ~~~ l3
  end

  subgraph read [Reading surfaces]
    direction TB
    profile["`**CollectionsSection**
    on /profile/{username}`"]:::spec
    search["`**/search**
    Collections group`"]:::spec
    page["`**/collections/{id}**
    header, Description, Coverage, Events`"]:::spec
  end

  subgraph write [Writing surfaces]
    direction TB
    panel["`**AddToCollectionPanel**
    a Popover on /events/{id}, owner and co-geolocators`"]:::spec
    newp["`**/collections/new**
    optional ?event={id}`"]:::spec
    edit["`**/collections/{id}/edit**
    owner only`"]:::spec
  end

  card["`**CollectionCard**, **CollectionCover**
  mosaic, title, meta line`"]:::shared
  reader["`**CollectionReader**
  map, DetailSidePanel, step list`"]:::shared
  form["`**CollectionDetailsForm**, **EventPicker**
  Details, Events in this collection, Add events`"]:::shared

  gu["`**GET /users/{username}/collections**`"]:::core
  gs["`**GET /search** type=collection`"]:::core
  gc["`**GET /collections/{id}**`"]:::core
  gce["`**GET /collections/{id}/events**
  walked to the end once`"]:::core
  act["`**POST /collections/{id}/report**
  **DELETE /collections/{id}**`"]:::core
  ge["`**GET /events/{id}/collections**`"]:::core
  pick["`**GET /events**, **GET /search**
  the picker's two sources`"]:::core
  post["`**POST /collections**`"]:::core
  patch["`**PATCH /collections/{id}**`"]:::core
  member["`**PUT** / **DELETE /collections/{id}/events/{event_id}**`"]:::core

  profile --> card
  search --> card
  profile --> gu
  search --> gs
  page --> gc
  page --> reader --> gce
  page -->|"Report, Drop"| act
  panel --> ge
  panel -->|"toggle"| member
  panel -->|"New collection"| newp
  newp --> form
  edit --> form
  form --> pick
  form -->|"create"| post
  form -->|"save"| patch
  form -->|"save, per row"| member
```

#### The collection page

[`/collections/{id}`](../frontend/src/app/collections/[id]/page.tsx) is public and titles itself with the collection, the way the event page is the event.

- The header holds the title, the owner's byline with a neutral `Collection` [`<Pill>`](../frontend/src/components/ui/Pill.tsx), and the meta line. It carries no picture: the mosaic belongs to the card and to the [share card](#share-cards).
- Three `Card` sections follow, each under its own [`<SectionEyebrow>`](../frontend/src/components/ui/SectionEyebrow.tsx): **Description**, **Coverage**, and **Events**.
- **Description** prints the owner's text whole, at reading size, through [`renderProof`](../frontend/src/lib/proof.tsx), so its marks and lists are painted. It is a section rather than a header line because it runs to `COLLECTION_DESCRIPTION_MAX_LEN` characters.

**Coverage is a player**: [`<CollectionReader>`](../frontend/src/components/collections/CollectionReader.tsx) arranges the map page's two surfaces around a position instead of a selection.

- The map is the shared [`<Map>`](../frontend/src/components/map/Map.tsx) over the items' pins, `embedded` and framed on the whole set (`fitBounds`). On every step it flies to the current item (`flyTo`, which skips the first frame so the opening frame survives the mount, and holds the camera on an item with no coordinate) and dims the steps behind the reader (`dimmedIds`, `DIMMED_OPACITY`).
- No line joins the pins: a line claims a route between events that were only curated into one set.
- The panel is the map's [`<DetailSidePanel>`](../frontend/src/components/map/DetailSidePanel.tsx), which fetches nothing, renders the event handed to it, and takes no action tier. It remounts on each step (keyed by event id), which puts a long event back at its top.
- Map and panel sit side by side in a two-column block that stacks below `sm`. The panel takes its `inline` placement: a page column with no viewport insets, no sheet, no grab bar, and no height cap. The block is 32rem tall from `sm` up, under the map page's panel cap (`calc(100dvh-4.5rem)`). Below `sm` the map keeps the embedded map's fixed height and the panel runs as long as its event.
- A collection whose items carry no coordinate renders no map.
- The step rides `?step=` ([`collectionStepHref`](../frontend/src/lib/collections.ts)), 1-based, defaulting to 1, and clamped into the sequence by `readerStep`, so a shared link opens where its sender stood, or on the nearest real step. It moves with `router.replace` and `scroll: false`, so Back leaves the page rather than walking the steps.
- `ArrowLeft` / `ArrowRight` step too, read on the window, and skipped while an input, textarea, select or contenteditable has the caret or a modifier is held. The keys count from the last press rather than from the URL, so a held key walks the collection. Nothing plays on its own.

**Events is the player's index.** A click anywhere on a row moves the player there, and the current row wears the accent border (`<EntityCard>`'s `onSelect` + `selected`, see [Cards](#cards)). The event's own page is reached from the panel's title. The rows are the same for the owner and a visitor and carry no control: an event joins from its own page or from the edit page's picker, which the sentence under the eyebrow states. The section header's one link is **Your geolocations**, the owner's catalogue in search through `profileSearchHref` ([`lib/search.ts`](../frontend/src/lib/search.ts)), with no status filter, since an unconfirmed detection is still the owner's to shelve.

**One read serves the pins, the panel, and the rows.** `fetchCollectionSequence` walks `GET /collections/{id}/events` to the end of its cursor once, under the `READER_MAX_ITEMS` ceiling (past it the page holds the earliest 500 items and marks no cut). `N of M` counts what the list shows. There is no collection-scoped points endpoint.

**The header cluster is a row of icon buttons.** Share on X and Report lead, and the owner's Edit and Drop follow, so the destructive control sits at the edge. It wraps into right-aligned lines, `flex-wrap justify-end`.

- **Share on X** is the ghost [`<ShareOnX>`](../frontend/src/components/share/ShareOnX.tsx) icon button, prefilled with the title, `by {owner}`, the meta line's segments, and the collection's URL. It has no confirm, since a collection has no `detected` state.
- **Report** is the red `dangerGhost` flag, for every reader, signed out included: [`useReportContent`](../frontend/src/components/report/useReportContent.tsx), the event page's dialog, with the same five buckets and 2000-character cap. The dialog names its subject (*Report this collection*), so it never reads as a report on the current item.
- **Edit** is the `ghost` pencil, owner only, `buttonClasses` on a `<Link>`.
- **Drop** is the red `danger` trash, owner only, behind [`useConfirmAction`](../frontend/src/hooks/useConfirmAction.ts) with `DANGER_CONFIRM` on the armed second click; the label says which click it is. On success the owner lands on their profile. This is the only place a collection is dropped; the edit page carries no drop.

#### The card and the meta line

- The meta line states the count, zero included, then the span the items cover, and the card and the page print the same one ([`collectionMetaSegments`](../frontend/src/lib/collections.ts)). The span prints only where items carry dates, and a single day prints once. Under it, both print the collection's derived tags in the neutral `<Pill>` row an event card uses (`CollectionTags` in [`CollectionCard.tsx`](../frontend/src/components/collections/CollectionCard.tsx)), uncapped.
- `CollectionIcon` ([`lib/collections.ts`](../frontend/src/lib/collections.ts)) is the one glyph for the type: the `Collection` pill, the **Collections** option of the result type control on `/search`, the profile section's first-run state, and the shelving control on an event page.
- The card's picture is [`<CollectionCover>`](../frontend/src/components/collections/CollectionCover.tsx), made of the collection's own items. The server sends up to four tiles in reading order (see [`api.md`](api.md#get-collectionsid)). One tile fills the 16:9 slot, two split it down the middle, three put the earliest item tall on the left with the next two stacked beside it, and four fill a 2x2, all with 2px gaps in the card border's neutral. A collection with nothing to show falls back to the "no media" box. Nothing is uploaded or stored.
- Each tile goes through the catalogue card's media slot and reads `kind`, so a video tile plays as a clip. A tile also reads `role`: a tile from a proof image reads the original, since proof uploads carry no `_hero` or `_thumb` derivative.

#### Writing a collection

Opening one is [`/collections/new`](../frontend/src/app/collections/new/page.tsx) and changing one is [`/collections/{id}/edit`](../frontend/src/app/collections/[id]/edit/page.tsx), the shape `/events/{id}/edit` takes, so a reload keeps the write and a link reaches it.

- Both sit behind `useRequireAuth` and render [`<CollectionDetailsForm>`](../frontend/src/components/collections/CollectionDetailsForm.tsx), which composes `PageShell`: **Cancel** and the submit in its sticky actions, then three `Card` sections, **Details**, **Events in this collection**, and **Add events**, each headed by a `<SectionHeading>`. Only the verb on the button differs. The edit page carries no subtitle; the Title field names the collection.
- **Details** is the title over the description, each with the shared `used / cap` [`<CharCounter>`](../frontend/src/components/ui/CharCounter.tsx) against `COLLECTION_TITLE_MAX_LEN` and `COLLECTION_DESCRIPTION_MAX_LEN`. The submit is never disabled: a [`<CountBadge>`](#build-on-shared-primitives) counts the blank or over-long fields, and a click on an incomplete form writes nothing. It outlines each in red (`FORM_INVALID_FIELD`, `FORM_INVALID_LABEL`) until it is filled, and `IncompleteFormAnnouncer` reads the list to a screen reader. An over-long value turns red as it is typed, with its counter. The form sets `noValidate`. Both fields ride every write and are the only writable fields.
- The description field is [`<ProofEditor>`](../frontend/src/components/editor/ProofEditor.tsx) under `allowImages={false}`: bold, italic, headings, lists, and links, no images, since nothing on this form uploads and the server drops the node. It wears the field box, the `focus-within` accent border, and `FORM_INVALID_FIELD` on refusal, with its label and counter on the row above. The counter measures `htmlText` ([`lib/proof.tsx`](../frontend/src/lib/proof.tsx)), the projection the server caps, so markup costs nothing (see [Rich text](#rich-text)).
- `/collections/new` has two entry points: the profile section (beside its heading and in its first-run state) and the add-to-collection panel, which passes `?event={id}`. With the parameter the page opens holding that event, the create carries it ([`POST /collections`](api.md#post-collections)), and the page returns to the event. Without it the page opens the collection it created. Cancel and Back return to where the reader came from.
- `/collections/{id}/edit` is owner only. A non-owner gets the backend's 403 stated before the form, with a link to the collection. The save writes the difference: the details through `PATCH`, then one `PUT` per added row and one `DELETE` per removed row, in that order, stopping at the first refusal and naming the act that failed. Saving returns to the collection.

[`<EventPicker>`](../frontend/src/components/collections/EventPicker.tsx) renders the two event cards on both write pages, the same on each, each its own `Card` under a `<SectionHeading>`:

- **Events in this collection** is the pending set: the rows the edit page opened with, the `?event=` row, and everything added since. Its line states the count through `eventCountLabel`, and its rows take the collection page's order (event date, earliest first, undated last). The rows are a carousel [`<HorizontalScroller>`](../frontend/src/components/ui/HorizontalScroller.tsx), one large block at a time: the feed [`<EntityCard>`](../frontend/src/components/ui/EntityCard.tsx) (`<CollectionItemCard large>`), its title linking to the event, with a red `dangerGhost` **Remove** under it. A pick moves the carousel to the added row, and a removal to the removed row's neighbour. An empty card is the plain [`<EmptyState>`](../frontend/src/components/ui/EmptyState.tsx) pointing at the card below. Nothing writes until the page's submit.
- **Add events** is a [`<Combobox>`](../frontend/src/components/ui/Combobox.tsx) that opens on focus and lists at most `PICKER_ROW_LIMIT` rows, each the title, the event date and the lifecycle badge. A row already held leaves the list, and the list stays open after a pick. With the field empty it lists the analyst's catalogue newest first through [`GET /events`](api.md#get-events) (`view=located`, `author=`, scoped to `COLLECTABLE_STATUSES`, `limit=`), whose cursor tells it more exists. A typed query goes to [`GET /search`](api.md#get-search) (`type=event`, `author=`), which returns the pre-cap match count.
  - The list's status row says what it is not showing and that search reaches it, or why it is empty. A search adds that it answers from the located group, which requires coordinates, so an event with none is reachable only with the field cleared.
  - The query is debounced at 300ms. Enter takes the highlighted row and never submits the form.
  - Both sources ask only for collectable statuses, so the card never offers a row the add verb refuses.

#### Search, shelving, and moderation

**Search.** `/search` carries a `Collections` result group and a **Collections** option in the result type control, between Events and Analysts. Each hit is `<CollectionCard showOwner>`, whose meta line leads with `by user` through `<AuthorByline link={false}>`. On this scope the filter panel shows the Author section only: every other filter is an event predicate, and the backend empties the group on it, while `author` narrows the group (see [`api.md`](api.md#get-search)). It is the event scope's own section, the typeahead over `GET /search/authors`, so a scope change keeps the analyst. The panel takes its sections per scope through the `sections` prop of [`EventFilterSections.tsx`](../frontend/src/components/filters/EventFilterSections.tsx), which also drops Status and Approvals on the legacy request scope. Every section of the filter panel opens collapsed on the map, the search page, the Requests board and the feed, except a section that holds an active value, which opens expanded so the applied filters stay visible; each header still toggles its section.

**Approvals filter.** The map, the search page's event scopes and the feed offer an **Approvals** section, last in the panel. **Approved only** is a one-chip `ChipBucket` that sends [`approved`](api.md#get-events). **Approved by** is an `<AccountPicker>` over the `user` and `organization` groups of `GET /search` (`suggestApprovers` in [`lib/search.ts`](../frontend/src/lib/search.ts)). An analyst sends `approved_by` and an organization sends `approved_by_org`, and Enter on a typed handle picks it as an analyst. Each value has a removable pill (**Approved**, **Approved by** *name*) and counts once in **Filters (N)**. `appendApprovalFilters` writes the keys into every request and the search page's URL, and `approvalFiltersFromParams` reads them back. The Requests board leaves the section out, because a request carries no approval.

**Shelving.** [`<AddToCollectionPanel>`](../frontend/src/components/collections/AddToCollectionPanel.tsx) opens in a `<Popover>` from the event page's **Add to collection** button, for the owner and every co-geolocator of a `geolocated` or `detected` row; on a request or a closed row the control is absent. The list scrolls past `18rem`, since the panel is fixed to the viewport.

- Each collection is a [`<ToggleRow>`](../frontend/src/components/ui/ToggleRow.tsx) in its described shape: the title at reading size over the item count (`eventCountLabel`), since a title runs to 255 characters. The list supplies its own dividers and row padding, as the settings card does.
- A `New collection` row links to `/collections/new?event={id}`.
- The toggle is optimistic: the bit and the count flip on the click and roll back on a refusal, which the panel's error banner explains. Both membership writes are idempotent.

**Moderation.** [`POST /collections/{id}/report`](api.md#post-collectionsidreport) writes to the event reports' table, and [`<ReportsPanel>`](../frontend/src/components/admin/ReportsPanel.tsx) lists collection reports beside event reports. A collection row prints the title as the link and the owner's `<AuthorByline>` beside it, since an admin recognises a collection by name rather than id. Its verdicts are `Hide the collection`, which confirms in a `<ConfirmDialog>` like the event takedown, and `Dismiss`. It offers no `Mark graphic`, since a collection carries no media of its own.

### Requests board

[`/requests`](../frontend/src/app/requests/page.tsx) lists open requests from [`GET /events`](api.md#get-events) with `view=requested&status=requested`, cursor-paged behind a **Load more** button. The board is public by link, but the rail lists it only for a signed-in reader. On a request page, a signed-out reader sees **Geolocate** under the actions row, which opens the sign-in page and returns to the submit form.

- The status is fixed to `requested`. The board mounts the shared filter panel ([`EventFilterSections`](../frontend/src/components/filters/EventFilterSections.tsx)) in the [filter rail](#right-rail) without its Status section, because a `closed` chip would read as "done" on a work queue. The media filter is also left out, because `GET /events` takes no `media` filter.
- The panel offers Conflict, Source kind, Level, Location guess, Tags and Author. Location guess is offered on the board alone. **With a guess** keeps requests that carry a guessed point, **No guess** keeps the blind ones, and picking both or neither drops the filter. The section sends [`has_coords`](api.md#get-events).
- A `<SegmentedControl>` orders the list **Newest** (the default) or **Oldest**. It sends [`sort`](api.md#get-events), so every page of the cursor walk keeps that order.
- Each card shows how long the request has been open, in whole days from `requested_at`, through `<EntityCard>`'s `age` slot: *Open today*, *Open 1 day*, *Open 12 days*. A row with no `requested_at` shows no age.
- Filters and sort live in page state and reset on reload.

### Share cards

A pasted link is how most readers meet the platform, so the four pages an analyst shares generate their own preview image. Every card is a [`next/og`](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image) (Satori) composition on one frame, [`_og/card.tsx`](../frontend/src/app/_og/card.tsx): a 1200×630 canvas, the bundled Montserrat 700 cut, the accent-`V` wordmark, the `vidit.app` footer, and the hex palette. Satori accepts no class names, which is why the cards compose that frame instead of the `components/ui/` primitives (see *Sanctioned one-offs*). The palette in `card.tsx` restates the same neutral / orange scale the classes resolve to, and is the one place a card reads colour from.

| Card | Content |
|---|---|
| Site default, [`app/opengraph-image.tsx`](../frontend/src/app/opengraph-image.tsx) | Headline and subhead. Inherited by every route that generates none of its own. |
| Profile, [`profile/[username]/opengraph-image.tsx`](../frontend/src/app/profile/[username]/opengraph-image.tsx) | Avatar (or the handle monogram), handle, bio, and four counts under the page's own labels: geolocated, detected, followers, media. `ogProfileCounts` in [`lib/og.ts`](../frontend/src/lib/og.ts) reads geolocated and detected off the Insights payload, co-geolocated events included, and followers off the header's; the link description lists the same three. A failed stats read keeps geolocated on `geolocations_count`, the same figure, and drops detected and media. Top conflicts sit in the footer. |
| Organization, [`organizations/[slug]/opengraph-image.tsx`](../frontend/src/app/organizations/[slug]/opengraph-image.tsx) | The profile card's layout ([`_og/portfolio.tsx`](../frontend/src/app/_og/portfolio.tsx), shared by both) with an `Organization` badge: picture or name monogram, name, bio, the member count, and the X handle in the footer. |
| Event, [`events/[id]/opengraph-image.tsx`](../frontend/src/app/events/[id]/opengraph-image.tsx) | Title, coordinates, the analyst's handle and the event date, the lifecycle badge, and the locator panel. |
| Collection, [`collections/[id]/opengraph-image.tsx`](../frontend/src/app/collections/[id]/opengraph-image.tsx) | Title, the meta line's count and span, the owner's handle, a `Collection` badge, and the mosaic panel. |

The **locator panel** ([`_og/MiniMap.tsx`](../frontend/src/app/_og/MiniMap.tsx)) is a plate-carrée graticule with the event's point marked on it, drawn from positioned rectangles: no tiles, no basemap request, no static-map service, and no mapping library on the server. What a reader can use at card size is the hemisphere and the rough region, and the real `<Map>` is one click away on the page. The projection is [`lib/og.ts`](../frontend/src/lib/og.ts)'s `projectEquirectangular`, which clamps rather than escapes the frame.

Under the graticule sits a **world outline**, one inline SVG path of Natural Earth 110m land ([`_og/landmass.ts`](../frontend/src/app/_og/landmass.ts), public domain, Antarctica and small islands dropped, aggressively simplified to a few kB), which is what makes a marker read as a place rather than as a point on a grid. It is committed path data in the projection's own 360×180 frame, so it needs no reprojection to line up with the marker and the card still loads nothing at request time. Regenerate it with [`scripts/build-og-landmass.mjs`](../frontend/scripts/build-og-landmass.mjs); the source dataset is not committed.

The event card takes its lifecycle word and emphasis from `EVENT_STATUS_META` in [`StatusBadge.tsx`](../frontend/src/components/event/StatusBadge.tsx), the same map the page's badge renders from, so a row cannot be called one thing on the page and another in the image of the page.

The **mosaic panel** on the collection card is the picture the profile card wears, at card scale. `ogMosaicBoxes` in [`lib/og.ts`](../frontend/src/lib/og.ts) places each tile in [`<CollectionCover>`](../frontend/src/components/collections/CollectionCover.tsx)'s arrangement and gap, as absolute boxes since Satori lays out flex and not grid, and clamps a longer cover to four boxes. A tile's picture is read at the derivative its own size wants through [`displayUrlsFor`](../frontend/src/lib/mediaUrls.ts), the wide `_hero` for a lone tile and the 400px `_thumb` for one sharing the panel, and all of them are fetched at once. A tile off a proof image is fetched at its original, since that upload writes no derivative. A clip carries no poster derivative, so its tile draws the panel colour under a play triangle instead of a frame the server does not have; a picture whose fetch was refused draws the same tile without the triangle. A collection with nothing showable draws the panel under `no media`, the site's own placeholder wording.

Each dynamic card reads the same anonymous public payloads its page renders from (`GET /users/{username}` plus `GET /users/{username}/stats`, `GET /organizations/{slug}`, `GET /events/{id}`, or `GET /collections/{id}`), issued together rather than chained, so a card can only ever show what a signed-out visitor already sees and an unfurl costs one round of requests. Soft-deleted rows 404 upstream.

An upstream read answers one of three ways, and the difference is visible because a crawler caches what it is served:

| Read | Card | Tags |
|---|---|---|
| Answered | The data card | Title, description, `og:*`, `twitter:*` from the payload |
| Permanent miss (`404`, or the `422` a path parameter that names no row draws) | The branded *No analyst here* / *No organization here* / *No event here* / *No collection here* card | The matching not-found title and description, in the same tag shape as a hit |
| Failed (`429`, `5xx`, timeout, undecodable body) | The site-default composition | None: the page inherits the site-wide metadata |

The failed path says nothing about the link because nothing is known about it, and its image response carries `Cache-Control: no-store` so the CDN and any crawler that honours it ask again rather than keep a card built from a bad second. A crawler that caches on its own policy regardless cannot be reached from here, which is the other half of why that path emits no not-found copy: whatever it keeps, it keeps a neutral preview.

Card reads carry a 15 min revalidate. That window is also the rate-limit headroom: every card request egresses from the deployment's shared IP against the per-IP limit on `/users/{username}`, `/organizations/{slug}`, `/events/{id}` and `/collections/{id}`, so a link going wide is one cached read per window rather than one backend round trip per unfurl. A link wide enough to still trip the limit degrades to the site-default card, never to a broken image.

All four pages are client components, so their `generateMetadata` lives on the segment layout (the profile and the organization build theirs through `portfolioMetadata` in [`_og/metadata.ts`](../frontend/src/app/_og/metadata.ts)): title, description, the `og:*` set, and `twitter:card: summary_large_image`, which is what makes X and Discord render the image full-width instead of as a square thumbnail. `twitter-image.tsx` re-exports the Open Graph composition so the two stay byte-identical.

The renderer publishes what it fetches as a public image, so every picture a card draws goes through one guarded read, `ogImageDataUri` in [`_og/data.ts`](../frontend/src/app/_og/data.ts) (guards also in [`lib/og.ts`](../frontend/src/lib/og.ts)), which inlines the body as a data URI rather than handing Satori a remote `<img src>`. The read accepts only an https dotted hostname, refuses address literals and local suffixes, and refuses a host whose DNS answer holds any private, loopback, link-local, or multicast address, judged in the connector so the socket uses the address the guard checked. It follows no redirect, holds a 3 s budget and an 8 MB ceiling, and accepts PNG, JPEG, GIF, WebP, and AVIF. The rasteriser behind `next/og` draws only PNG and JPEG and leaves a blank for anything else, so the read inlines a PNG or JPEG of 2 MB or less as fetched and re-encodes every other picture through `sharp` as a PNG at most 1200 px on its long edge (the first frame of an animated GIF). A refused read falls back to the drawing without a picture (the handle monogram, a blank mosaic tile) and logs one `og image skipped:` warning naming the reason and the picture's host and path. `users.avatar_url` and cover tile URLs are server-minted, never typed by an analyst, so the guard is defense in depth. The API's own origin skips the host guards: it serves the local storage backend's pictures in development (`http://localhost:8000/local-storage/...`), and the card trusts it as it trusts the payload reads.

### Email

Every email shares one layout, [`services/email_layout.py`](../backend/app/services/email_layout.py), the second surface after the share cards that renders outside the app. Mail clients read no class names from the site and strip most CSS, so the layout carries its own inline styles: a table-based single column 600px wide, a system font stack, and the hex values below. The mechanism and the queue are in [`engineering.md`](engineering.md#email).

| Part | Light (default) | Dark (`prefers-color-scheme: dark`) |
|---|---|---|
| Page | `#f4f2ef`, the light theme's warm canvas | `#0a0a0a`, `neutral-950` |
| Card | `#ffffff` | `#171717`, `neutral-900` |
| Text | `#232323`, the light theme's `neutral-100` | `#f5f5f5` |
| Inline link | `#c2410c`, `orange-700` | `#fb923c`, `orange-400` |
| Action button | `#c2410c` fill, white label | unchanged |

- **Light by default.** A client that ignores the dark media query, such as Gmail, gets the light layout and applies its own dark inversion to it. Apple Mail applies the dark values.
- **The header** is the accent `V` mark, a PNG served by the frontend at `/icon/android-192` with a transparent background, beside the word Vidit in text. The word carries the brand when a client blocks images.
- **The action button** is a solid `orange-700` fill, the one place the accent fills a control. A mail client cannot render the tinted-on-dark recipe reliably, and `orange-700` keeps a white label above the 4.5:1 contrast ratio. Under the button, the same URL is printed as a link for a client that drops the button.
- **The footer** links to Settings and the legal notice.
- **The completion digest** gives the count of detections awaiting completion and points at **Start reviewing** on the detections queue, which opens the one-by-one review pass.
- **A notification email** names the switch that sent it and links to Settings, and its `List-Unsubscribe` header turns that kind off by email.
- **The registration confirmation email** links the [Getting started page](#getting-started-page) in its last paragraph, under the confirm action's explanation.

### Buttons

There is one primitive: [`<Button>`](../frontend/src/components/ui/Button.tsx), shape and colour in a single unit at one size (no size scale). It has five variants on two axes: tone (accent or danger) and emphasis (filled, outline, text):

- `primary`: accent, filled. The one main action of a view.
- `secondary`: accent, outline. A secondary action (edit, search, pagination).
- `ghost`: accent, text only. The quiet tier: cancel, dismiss, dense row actions, and (with `icon`) icon-only buttons.
- `danger`: red, outline. A destructive action (delete), quiet on purpose.
- `dangerGhost`: red, text only. A red control at ghost weight, so it sits in an icon row without outweighing its accent neighbours (the report flag).

**Remove.** [`<RemoveButton>`](../frontend/src/components/ui/RemoveButton.tsx) is the one remove control: a red `dangerGhost` icon button named by what it removes, the name showing as its tooltip. Its icon says what a click does. A removal that asks for a confirmation first, a second click or a dialog, shows a trash (`Trash2`, `confirms`); an instant removal shows a cross (`X`). A source editor's remove and the edit form's close show the trash; a link row's remove, a file slot's remove and a draft co-geolocator pick show the cross.

Every clickable is accent, and red is only for destructive or alerting actions. There is no grey button: grey lives in `<Pill>` neutral, and in the disabled state, which drops the variant's tone for grey text on a neutral border rather than fading it, so a button that refuses the click reads like every other inert control. The one loud filled red is `DANGER_CONFIRM`, applied through `className` to the armed second click of a destructive two-click confirm, so the strongest red shows once, at the point of no return. A confirm that is not destructive takes `ARMED_RING` the same way (the share row's detection link, the detection form's Submit): a ring and a neutral plate over the button's own variant, so an armed control reads as changed without moving. `fullWidth` stretches it (auth submits). `icon` makes a square icon-only button. A `<Link>` that should look like a button takes `buttonClasses(variant)`.

**Tap size.** Both shapes stand taller on a phone (`min-h-9` on the text shape, `size-9` on the icon square), dropping to the desktop 28px / 32px from `sm` up. Only the tappable height moves. The type scale and the horizontal padding are the same at every width. The `?` grows its own target the same way; see *Field help* below.

### Forms

**One submit page, content-gated.** [`/submit`](../frontend/src/app/submit/page.tsx) is a single form: you fill in what you have, and two actions publish from the content, "Publish geolocation" (born `geolocated`) or "Publish request" (born `requested`). Each is gated on a live requirements tick-list that escalates from the request floor to the full geolocation floor. `/submit` opens on a chooser of three [`<IconTile>`](../frontend/src/components/ui/IconTile.tsx) links, each with an icon, a title and one sentence: **Single event** (geolocate one event, or ask the community to geolocate it), **From an X post** (paste a link to one of your own posts, which becomes a detection you review), and **Bulk import** (upload your X archive; each geolocation in your posts becomes a detection to review). A tile opens its path in place of the chooser and names it in the `mode` query (`single`, `xpost` or `bulk`, built by `submitHref` in [`lib/routes.ts`](../frontend/src/lib/routes.ts)), so a reload keeps the path and the browser's Back returns to the chooser. On a path the page header carries the `PageShell` back arrow, which returns to the chooser: a step back through the history when the chooser opened the path, and a navigation to `/submit` otherwise (`onBack`). The draft lives in the page, above the form, so it survives a trip through the chooser: the fields reseed from it when the path opens again. `?import=1`, the target of the onboarding card and the `/import` guide, opens **Bulk import**. A link that asks for the form opens it directly (`?mode=single`): **Post request** on the Requests board, the empty profile's first-submission link, and the guide's submit tile. `/requests/new` redirects to the form, and `/geolocations/new` redirects to `/submit` with its query. A request is answered from its own [edit form](#the-owner-edit-form), not from here.

**Submit actions.** The submit form renders the edit form's shell, `EventFormShell`, and its writes are the page's sticky actions, in the *Actions* landmark at the top right of the header, pinned while the fields scroll. It is the edit form's [`PublishActions`](../frontend/src/components/geolocations/PublishActions.tsx): **Publish geolocation** (primary) and **Publish request** on one right-aligned line, then the `?` (`action_submit`) from `sm` up, since the two buttons fill a 320px line, then the error banner, `role="alert"`. Each button carries a [`<CountBadge>`](#build-on-shared-primitives) of the conditions it still misses, and dims while short: **Publish request** counts the request floor, and **Publish geolocation** counts the request floor plus the proof, the coordinates and the conflict. The list shows on hover, on keyboard focus, or on a tap on the count. Both publish: the first click arms the button in place (*Confirm*, `ARMED_RING`, its sentence in a live region), and the second writes. Below `lg` the buttons drop their icons, so both fit one line at 320px. The hidden `IncompleteFormAnnouncer` sits in `actions.below`. The import entries render the chooser's `PageShell` instead, without the form or its actions.

**One write flow.** The submit form and the edit form write through the same controller, so the two forms check, word and post a write the same way.

```mermaid
flowchart TB
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`the controller, thick-bordered`"]:::core
    l2["`a step of the gate`"]:::spec
    l3["`what the form state or a form supplies`"]:::shared
    l1 ~~~ l2 ~~~ l3
  end

  state["`**useEventForm**
  publishMissing, requestMissing
  publishInput, requestInput`"]:::shared
  write["`**useEventWrite**, one per button
  the mutation, the gate, usePublishAction`"]:::core
  group["`**writeGroup**
  one banner, busy, the reset`"]:::shared

  subgraph gate [The gate, on every click]
    direction TB
    reset["`**reset**: every write's banner, the red outlines`"]:::spec
    taxonomy["`**conflict options**, a publish floor only
    still loading or failed: the banner`"]:::spec
    floor["`**the floor**: every missing field red at once`"]:::spec
    hold["`**sourcesBlockWrite**: an upload running, a refused snapshot
    the banner`"]:::spec
    extra["`**extraCheck**, the form's own refusal
    Nothing changed since version N`"]:::spec
    reset --> taxonomy --> floor --> hold --> extra
  end

  arm["`**arm, ask or write**
  PUBLISH_CONFIRM, REQUEST_CONFIRM, the version note`"]:::shared
  success["`**onSuccess**, each form's own route`"]:::shared

  state --> write
  group --> write
  write --> gate --> arm --> success
```

- **The form state.** [`useEventForm`](../frontend/src/components/geolocations/EventFormFields.tsx) computes both floors live: `requestMissing`, and `publishMissing`, which is the request floor followed by the rest in page order (title, the sources' file, URL and kind, the proof or its image, the coordinates, the conflict). It also builds both bodies: `publishInput` posts the subject point as required, and `requestInput` posts it as an optional guess, both halves or neither. A form adds only what its endpoint takes on top, `version_no` and the version note.
- **The controller.** [`useEventWrite`](../frontend/src/components/geolocations/useEventWrite.ts) is one write per button: its mutation, its gate and its arming (`usePublishAction`). `writeGroup` reads a form's writes together: the one error banner, whether any write runs, and the reset each click starts with.
- **The gate.** Every click runs it in the order of the diagram. The conflict options come before the floor, because before they load a missing conflict cannot be told from one still loading. The floor comes before the sources' hold, because a running upload clears itself and must not hide a field you have to fill. The form's own refusal comes last: the edit form refuses a version that changes nothing. A refusal other than a missing field prints in the banner.
- **The wording.** [`PublishActions`](../frontend/src/components/geolocations/PublishActions.tsx) exports what both forms show: the armed sentence of each publish (`PUBLISH_CONFIRM`, `REQUEST_CONFIRM`), the busy labels (`PUBLISHING_LABEL`, `SAVING_LABEL`), and the two button presets, `publishGeolocationButton` (primary, map pin) and `requestWriteButton` (secondary, megaphone). `WRITE_FALLBACK` holds one fallback sentence per write kind. Where a write lands on success stays with each form.

Section placement follows [Event layout](#event-layout): Title, **Sources** and **Proof** in the main column; **Location** and **Details** (event date and time, the provenance link of an imported row, conflict and tags) in the side column. Each section reads like the event page's: its [`<SectionEyebrow>`](../frontend/src/components/ui/SectionEyebrow.tsx), with the section `?`, sits on the page above the section's card. **Proof** carries the *Methodology guide* link beside its eyebrow, and a publish attempt that flags the proof turns the eyebrow red and outlines the card. **Sources** has no card of its own: each source editor is a card. Fields use the [`<Input>`](../frontend/src/components/ui/Input.tsx) primitive. **Sources** is the row of source editors that [Source blocks](#source-blocks) describes, reused by submit, request, detection review and the published-row edit so they can't drift; each editor's file slot sits on the generic [`FileManager`](../frontend/src/components/ui/FileManager.tsx). **From an X post** is [`ImportPostPanel`](../frontend/src/components/geolocations/ImportPostPanel.tsx): a URL field and one action. The post becomes detections server-side, and the panel opens the first one in the detections queue; a run with something to say (warnings, a refusal, a post already imported) stays on the panel and says it, with the review one click away. **Bulk import** is [`ImportArchivePanel`](../frontend/src/components/geolocations/ImportArchivePanel.tsx), whose export walkthrough is a `boxed` [`NumberedSteps`](../frontend/src/components/ui/NumberedSteps.tsx).

**Coordinates travel as a pair.** Every pair (the subject point and each source's capture position) is the shared [`CoordinateInputs`](../frontend/src/components/geolocations/CoordinateInputs.tsx). A paste that reads as a pair fills both fields whichever one received it: a decimal `lat, lng` (comma or space separated, degree signs tolerated), or a Google Maps URL (`@lat,lng`, `q=`, `query=`) when the paste is itself a URL. Anything else pastes as ordinary text, prose quoting `@48.5,37.8` included. [`<CoordinateActions>`](../frontend/src/components/event/CoordinateActions.tsx) follows the two fields on their line, so a coordinate can be checked against satellite imagery and carried away while it is being typed. It is two outlined icon buttons everywhere it appears, each its own box. The map link (new tab) is named *View on Maps* by its `aria-label` and its tooltip, and the copy composes the same primitive over `useCopyToClipboard`. While the pair is half-typed or out of bounds both controls stay in place, disabled and grey, rather than disappearing, so the line holds one width and a grey control says the point is not usable yet; the map link becomes a disabled button there, since there is nothing to navigate to. The event detail page's coordinates row renders the same component, right-aligned on the coordinates line, so the two surfaces can't drift; the pair and its actions hold one line there, and on a narrow phone row the **Coordinates** label wraps first, then the line drops under it. On a form, the **Location** card labels the pair **Coordinates**, with the same `?` as the page's row. The parser, the bounds, the rendering (6 decimals, 4 in a compact row) and the map-link builder have one home, [`lib/coordinates.ts`](../frontend/src/lib/coordinates.ts).

**A locked URL is the link.** One field arrives filled and stays that way: the provenance URL (`detected_from_url`) on an imported detection. A request's sources are not locked: the analyst who publishes it corrects them like any other field. The locked field carries [`LockedHint`](../frontend/src/components/geolocations/fields/LockedHint.tsx) beside its label, saying why it cannot be retyped, and renders its value through [`LockedUrl`](../frontend/src/components/geolocations/fields/LockedUrl.tsx): an anchor wearing `LOCKED_FIELD`, the box recipe the locked `<Input>` wears, so it reads as the field it is. A stored URL is a link everywhere on the platform, a locked field included. The anchor carries the full URL rather than a host, and truncates rather than wraps so a long permalink keeps the field one line high. `LOCKED_FIELD` lives on [`Input`](../frontend/src/components/ui/Input.tsx) and the locked `<Input>` and `LockedUrl` both wear it, minus `cursor-not-allowed`, which states "you cannot act on this" and is true of the input alone. The label becomes a `<span>` in link mode, because an anchor is not a labelable control. A locked field with no value yet keeps the read-only input: there is no link to render.

**The detections queue is a list, and the work happens in review mode.** `/profile/{username}/detections` is a dense list, one [`DetectionQueueRow`](../frontend/src/components/detections/DetectionQueueRow.tsx) per detection: a thumbnail, the title, the event date, the source host, and one state badge. The badge describes the evidence, not completeness (`batchCompletionBlockers` in [`lib/events.ts`](../frontend/src/lib/events.ts), which mirrors the server floor in `services/events/batch._publish_detection`; `detection_ready_predicate` is that same floor in SQL, which is what the filter below pages on, and the three are held to one table of detection shapes by their tests). It reads **Ready to review** when the machine found everything it could and the detection is waiting on the judgment a review supplies, the conflict and the source kind, so it takes `<Pill>`'s outline `secondary` tone rather than the filled accent: a detection that still needs two picks must not read as a finished one. Otherwise it names the missing piece, or counts them (*Missing: 2 pieces*) once several names would outgrow a dense row. A [`<SegmentedControl>`](../frontend/src/components/ui/SegmentedControl.tsx) narrows the queue to ready or incomplete detections. It is a query, not a view filter: picking an option refetches with [`readiness`](api.md#get-eventsdetections), so the server cuts the page out of the filtered set and the row count, the page count and the empty line all describe that set. A page-local filter answers about the ten rows on screen while the reader takes it as an answer about the queue, which on an import of several hundred detections ordered newest first is how "0 of 10 on this page" gets read as "none of my work carries any evidence". Beside the bar, `ready_total` and `incomplete_total` state the whole queue's split under every option and on every page, so the one number an analyst wants after an import needs no paging to find. Its labels are one word each, so a `<FieldHelp>` `?` beside the bar says what Ready and Incomplete select, once for the page, and that is where both badges' meaning lives: the rows themselves carry a label and nothing to hover, and the pieces a detection is missing are named in place by the form. A queue with no detection left reads one line, *Nothing left to review.*, in the `boxed` [`<EmptyState>`](../frontend/src/components/ui/EmptyState.tsx): the page is reached that way only after the last submit, since nothing links to it while the queue is empty, and the header's back control returns to the profile. There are no inline controls: the whole row is one click, to the edit form, which is where a detection missing evidence gets its manual pass. The click opens a review pass starting at that detection, since reaching a detection through the queue is working the queue. [`<LoadMoreRow>`](../frontend/src/components/ui/LoadMoreRow.tsx) sits at the foot: each page the server cuts appends under the rows already loaded, a line above it counts them against the filtered set, and a failed page retries in place. A failed first read prints in `FORM_ERROR_BANNER`.

**Reviewing is the same form on the same route, one detection at a time.** A queue row and a detection under review open one surface, [`EventEditForm`](../frontend/src/components/geolocations/edit/EventEditForm.tsx) at `/events/{id}/edit`, with the same sections in the same order and every field editable in both cases, the proof editor included. A review pass is that URL carrying `?queue=1`: one address per detection, so a reload keeps its place, the address bar says which detection is open, and the browser's Back steps back one detection. Every entry from the queue page sets the flag, a row click included, so a pass starts wherever the reader entered it; the bare URL stays reachable by hand for a single detection. *Start reviewing* points at `/profile/{username}/detections/review`, which reads the queue and hands over to the first detection's URL, replacing itself in history so Back from that detection lands on the queue list.

With the flag set on a detection the reader owns, the page reads the owner's queue, places the detection in it, and adds the pass's own chrome to the sticky actions: the position (*Detection n of m*) and **Skip**. **Publish** and the close sit in the sticky actions, as on every edit, and the position and **Skip** head them. Publishing runs the single-row [`POST /events/{id}/versions`](api.md#post-eventsidversions) behind the form's confirm and then opens the next detection instead of returning to the queue; closing, behind its own required-reason dialog, hands over the same way; **Skip** hands over without writing. Past the last detection the pass ends on the queue list. The position is read off the live queue, so a detection just published or closed is out of both the count and the walk, and a detection the queue no longer holds carries no position at all: the page is a plain edit again.

**Required by default.** No field carries a `required` or an `optional` marker: per-field markers make the form a legend to decode, and two guides say the same thing better. The count on each publish button names every unmet requirement of its publish path, and a clicked action outlines the missing fields in place. On submit, every missing field and its label turn red in place at once, not the first miss alone (`FORM_INVALID_FIELD`, `FORM_INVALID_LABEL`). No box on the page repeats the list. [`IncompleteFormAnnouncer`](../frontend/src/components/ui/IncompleteFormAnnouncer.tsx) reads it to a screen reader in one sentence on each attempt, from a visually hidden polite live region. The forms set `noValidate`, so the red outlines and the announcer, not native one-bubble-at-a-time validation, own the feedback. It is shared across geolocation, request, and detection submit, each computing its own required set (detection is a superset of create; request is a subset). One content rule: a geolocation's proof must contain an image (`proofHasImage`), the source-to-satellite cross-reference. Every publish sits behind a confirm, a detection's **Publish**, a request's, **Publish geolocation** and **Publish request** alike: a publish makes the event public, and a `detected` row is machine output nobody has vouched for, so a detection's publish applies the whole form and publishes it as `geolocated` in one step, after which every change to it is a version on a public record. The confirm **arms the button in place** rather than replacing it with a confirm pair: the label reads *Confirm*, the button takes `ARMED_RING`, and the second click writes. Nothing is inserted and nothing moves, so the second click lands where the first one did, and the button keeps focus, so Enter twice submits. It disarms on its own after a few seconds, on Escape, and on any click or focus landing elsewhere ([`useConfirmAction`](../frontend/src/hooks/useConfirmAction.ts) owns all of it). What the second click costs is in the `?` beside the button, and the armed state announces itself in a sibling live region, the shape every copy control uses, so no control renames itself mid-gesture.

The account forms follow the same rule: sign-in, registration, the password reset, the single-email forms (forgot password and resend confirmation), Settings → Change password and the invite-code form. Each sets `noValidate`, computes its blanks with `blankFields`, flags them through `useIncompleteForm` (its key type names the form's own fields), outlines each blank field and label with `FORM_INVALID_FIELD` and `FORM_INVALID_LABEL`, and announces them through an `IncompleteFormAnnouncer`. The server's and the password rule's messages still show in the error banner once every field is filled. An auth card labels its fields with `FORM_LABEL_COMPACT` and a Settings card with `FORM_LABEL`, because a card holds one family of labels and the auth card is the denser surface.

### Rich text

An event's proof and a collection's description are one format: HTML that the server sanitizes on every write. One editor writes it, one renderer reads it, and the server is the only place its rules are enforced.

```mermaid
flowchart LR
  classDef spec fill:#eef1fb,stroke:#4a5fa5,color:#33417a
  classDef shared fill:#e3f2f1,stroke:#0f7b7a,color:#0b5c5b
  classDef core fill:#0f7b7a,stroke:#083f3e,stroke-width:3px,color:#ffffff

  subgraph legend [Legend]
    direction LR
    l1["`a surface or a value in transit`"]:::spec
    l2["`a shared frontend helper`"]:::shared
    l3["`the one place a rule is enforced`"]:::core
    l1 ~~~ l2 ~~~ l3
  end

  subgraph write [Write]
    direction TB
    editor["`**ProofEditor**
    BlockNote, schema cut to the allowlist; emits blocksToHTMLLossy`"]:::shared
    staged["`**uploadFile**, **resolveFileUrl**
    stage the picked file under placeholder://name, preview it from a blob URL`"]:::shared
    form["`**the form**
    proof or description HTML, plus proof_files[] still referenced`"]:::spec
    text["`**htmlText**
    plain-text projection the description counter measures`"]:::shared
    editor --> form
    form --> text
      staged --> editor
  end

  subgraph server [Server]
    direction TB
    intake["`**intake**
    rewrites each placeholder:// src to the stored media URL`"]:::spec
    sanitize["`**sanitize.py**
    nh3 tag and attribute allowlist, safe_link_href, _safe_image_src`"]:::core
    stored["`**TEXT column**
    sanitized HTML; html_text fills description_text`"]:::spec
    sanitize --> intake --> stored
  end

  subgraph read [Read]
    direction TB
    render["`**renderProof**
    html-react-parser; allowlisted tags only, safe href and src`"]:::shared
    image["`**ProofImage**
    lightbox and graphic gate`"]:::shared
    render --> image
  end

  form --> sanitize
  stored --> render
```

#### The editor

[`<ProofEditor>`](../frontend/src/components/editor/ProofEditor.tsx) wraps [BlockNote](https://www.blocknotejs.org) with a schema cut to what the server stores:

- Blocks: paragraph, heading (levels 2 and 3), bulleted and numbered list items, quote, code block, divider, and image. `allowImages={false}` removes the image block for a collection's description.
- Styles: bold, italic, strikethrough, and inline code. Underline is not offered, because the server drops `<u>`.
- Links: BlockNote's link control accepts only what `isSafeLinkHref` accepts, an absolute http(s) URL.

The formatting toolbar drops the alignment, nesting, and replace-file buttons, since the stored HTML carries no alignment or nesting and the replace panel offers an embed tab. The file panel offers upload only, so every image comes from the analyst's own file. The theme reads the neutral scale and accent as CSS variables, so the editor follows the reader's theme and accent. The text size is `FIELD_TEXT`, the size every other field uses. `bare` makes the editor the section's card itself, an event form's **Proof**: `ProofSection`'s card and `p-4` padding, and no inline padding of BlockNote's own, so the text starts where the event page's proof text starts; BlockNote's side menu floats into the card's padding.

The editor reads `initialContent` once, through `tryParseHTMLToBlocks`. Re-key the parent to seed it again. Each change emits `blocksToHTMLLossy` to `onChange`. BlockNote writes U+FFFC into an empty block, and the editor strips it before emitting.

#### Images

An image uploads at publish, not when it is picked:

1. BlockNote's `uploadFile` hook names the file with `safeProofFilename` and stores the block's URL as `placeholder://<filename>`.
2. `resolveFileUrl` previews that URL from a `blob:` URL while the analyst writes. A placeholder with no staged file loads a blank pixel, so no `placeholder://` src reaches an `img`. The editor empties its staging as it unmounts and revokes the blob URLs on the next task, once its images are gone.
3. Each change reports, through `onProofFilesChange`, the staged files whose placeholder is still an `<img src>` in the emitted HTML (`referencedProofFiles`).
4. The form posts those files as `proof_files[]` beside the HTML. The server matches each file to its placeholder by filename and rewrites the `src` to the stored media URL.

#### Storage

The server stores the body in a `TEXT` column and sanitizes every write with nh3 in [`sanitize.py`](../backend/app/services/sanitize.py) on the [rich text rules](api.md#rich-text).

#### The read view

[`renderProof`](../frontend/src/lib/proof.tsx) parses the stored HTML with html-react-parser and renders only allowlisted tags, each with its class from `TAG_CLASSES`. Any other tag renders its children only. Every attribute is dropped except:

- A link whose `href` passes `isSafeLinkHref` renders through `<OutboundLink ugc>` with `TEXT_LINK` (see [Outbound links](#outbound-links)). Any other link renders as its text.
- An image whose `src` passes `isSafeImageSrc` becomes [`<ProofImage>`](../frontend/src/components/event/ProofImage.tsx), which opens the shared lightbox. `gateImages` passes the event's `is_graphic` to it, so a proof image takes the same age confirmation as source media. A paragraph that holds an image renders as a `div`.

`isSafeLinkHref` and `isSafeImageSrc` mirror the server's predicates, so a body that bypasses the sanitizer still renders no unsafe URL.

#### Plain text

`htmlText` in [`lib/proof.tsx`](../frontend/src/lib/proof.tsx) mirrors the server's `html_text`: it concatenates the text with entities decoded, starts a new line at every block boundary and every `<br>`, trims each line, and drops blank lines. The collection description counter measures it, and the server caps the same projection and stores it as `description_text`. `proofHasImage` reads the same parse for the geolocation floor: a proof needs at least one `<img src>`.

### Field help (`?`)

[`FieldHelp`](../frontend/src/components/ui/FieldHelp.tsx) puts a `?` next to a field label, section heading, detail row, filter bar, or icon group: a one-line explanation on hover or focus, pinned on click (touch can't hover), dismissed by outside-click or Escape (a real `role="tooltip"`). It is the app's **one** explanation affordance: an explanation never rides on a native `title` attribute, whose bubble is the browser's chrome rather than Vidit's and appears on no other surface here (`title` stays for the bare name of an icon-only control). It is **neutral grey, not accent** (meta help), the one sanctioned exception to the rule that clickable implies accent. Each `?` is `<FieldHelp concept="…" />`. The concept registry [`lib/fieldHelp.ts`](../frontend/src/lib/fieldHelp.ts) pairs each concept's `text` and `label` once (wording mirrors [`data-model.md`](data-model.md)), so the same concept explains a field on the submit form, the detail page or map panel, and the filter panel without drift. The registry is the only source: a `?` takes a concept key and nothing else, so no instance can word a concept its own way. The `?` is the single source of section *help*: what a concept means is written once, in the registry, and never restated under a heading. A block still states what it counts in a line under its heading where the heading alone leaves the population unstated (the Insights card and its two charts), which is a statement about that block's data rather than a definition of a concept. Readers can hide every `?` through Settings → Display, leaving only labels and fields. The switch is saved to the account like the [theme](#theme).

**Tap size.** The glyph is 13px, too small to hit with a thumb, so on a phone, padding plus a matching negative margin grows the anchor to 29 by 25px while the `?` and the label beside it stay where they are. The vertical bleed stops at 6px, the label-to-input gap the form fields use, so a tap aimed at the input below the label reaches the input. The tooltip is positioned off that anchor, so it hangs a few pixels lower and further left on a phone than on desktop, where the glyph keeps its bare box.

### Sanctioned one-offs

Decided once, so review doesn't re-litigate them:

- **Search's `ProfileResult`**, the analyst and organization hit row, re-declares `EntityCard`'s shell: folding it in would leak avatar / no-thumbnail conditionals into `EntityCard` for one consumer. Commented at the call site.
- **`ProofSection`** composes `<Card className="p-4">`, one density step tighter than the default `p-5`, because proof is a reading surface. On a form it frames the proof editor (`ProofEditor bare`, which draws no frame of its own), with the field's focus border and, when a publish flags the proof, the red outline.
- **Admin dev tooling** ([`admin/ActionReceipt.tsx`](../frontend/src/components/admin/ActionReceipt.tsx)) is a deliberately lighter register than `<Card as="section">`, admin-local on purpose: admin-only surfaces don't earn `ui/` primitives.
- **The Satori surfaces** ([`app/_og/`](../frontend/src/app/_og) and the generated [`icon.tsx`](../frontend/src/app/icon.tsx) / [`apple-icon.tsx`](../frontend/src/app/apple-icon.tsx)) render to a PNG on the server, never to a DOM, and Satori supports neither class names nor most of the CSS the primitives rely on. The share cards all compose the one frame in `_og/card.tsx` (see *Share cards*), which is the boundary: one frame for the cards, not one layout per route. The icons draw a single letter at three sizes and share only the font read, which is not a frame's worth of chrome.

## What we avoid

- Heavy glow, neon, pulse effects
- Gradients
- Glass / blur
- Decorative icons
- Long or showy animations
- Too many distinct colours; one accent hue only
- Information overload on the default view

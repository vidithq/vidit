# Design principles and decisions

## Philosophy

**Spare by default, complex on demand.** Legible to first-time visitors; advanced filters and tools appear on demand. No dashboard-syndrome or dark-ops aesthetic.

1. **Progressive disclosure**: the default is a map and points; filters, detail, and tools appear on demand.
2. **Clarity over aesthetics**: every visual element serves a function.
3. **Neutral and professional**: sober tone, no military-tech or hacker-dashboard tropes.
4. **Controlled density**: map → points → detail panel → full proof. The reader picks the depth.

## Theme

**Dark by default, light on demand.** Uniform background, opaque panels, one warm accent for contrast. Dark reads better for long-session, data-dense work and stays the default; light is a second axis for readers who want it.

The theme is independent of the accent hue. The pick is browser-local (`localStorage` key `vidit:theme`), applied as `data-theme="light"` on `<html>`, which remaps the Tailwind `neutral-*` scale (plus the semantic `red` / `amber` danger and warning scales, mirrored so their pale text stops go dark on the light tint) to a curated soft light ramp ([`globals.css`](../frontend/src/app/globals.css)); dark is the default and carries no attribute. The block also sets `color-scheme` so native widgets (scrollbars, date / select popups) track the theme. Every `neutral-*` utility flips with no per-component change, the same mechanism as the accent palette below, so both preferences share one plumbing ([`attributePreference.ts`](../frontend/src/lib/attributePreference.ts)). The orange accent is owned by the palette switch, so it is not theme-adjusted; accent text (links, the success banner) reads a touch lighter in light mode. The map basemap can't read CSS variables, so [`Map.tsx`](../frontend/src/components/map/Map.tsx) swaps CARTO Dark Matter for its light counterpart Positron off [`useTheme`](../frontend/src/hooks/useTheme.ts).

## Colour palette

### Foundation

The dark roles below are the default. Light theme re-points the same `neutral-*` scale to a curated soft ramp (`globals.css`): a soft warm grey canvas (`neutral-950`) with warm off-white cards (`neutral-900`) floating on it, and dark-grey text (`neutral-100` = `#232323`, not black), so a large light surface reads as easy on the eyes rather than a flat near-white glare. The light surfaces carry a faint warmth (`R > G > B`); the text greys stay neutral. It mirrors how the dark scale avoids pure black and pure white.

| Role | Color | Tailwind | Usage |
|------|-------|----------|-------|
| Background | `#0a0a0a` | `neutral-950` | Global background, behind the map |
| Surface | `#171717` | `neutral-900` | Panels, cards, modals |
| Surface elevated | `#262626` | `neutral-800` | Inputs, interactive elements, hover |
| Border | `#333333` | `neutral-700` | Separators, field outlines |
| Text primary | `#f5f5f5` | `neutral-100` | Titles, primary content |
| Text secondary | `#a3a3a3` | `neutral-400` | Labels, metadata |
| Text muted | `#737373` | `neutral-500` | Placeholders, disabled elements |

### Accent

**One accent hue, selectable, orange by default.** Settings → Display also offers blue, emerald, violet, rose. The pick is browser-local (`localStorage` key `vidit:palette`), applied as `data-palette` on `<html>`, which remaps the Tailwind `orange-*` scale to the chosen hue ([`globals.css`](../frontend/src/app/globals.css)). Components keep writing `orange-*` utilities and the [`styles.ts`](../frontend/src/components/ui/styles.ts) constants unchanged, so everything below holds for whichever hue is active. Map markers can't read CSS variables, so their hex values live beside the palette in [`lib/palette.ts`](../frontend/src/lib/palette.ts).

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
| Warning | `#f59e0b` | `amber-500` | Non-blocking caution (`WARNING_CALLOUT`): duplicate probe, curated-tags load failure, tweet-import notice. Colour only; layout at the call site. |

## Accent recipe

Every accent treatment is a named constant from [`styles.ts`](../frontend/src/components/ui/styles.ts) or a primitive; use it, don't hand-roll the class string. The rule:

> If something carries the accent and isn't clickable, it's a bug. If something is clickable and isn't accent, it's a bug.

Carve-outs: navigation chrome stays neutral grey, destructive actions go red, and the `?` help is neutral (meta, not content). External links open in a new tab (`target="_blank" rel="noopener noreferrer"`) with the same accent styling.

Five buckets:

1. **Inline link** (`TEXT_LINK`): clickable accent text in copy or rows (bylines, source URLs, retry, empty-state CTAs), `text-orange-400 hover:underline`. An action that only reads like a link (Cancel, dismiss) is a `<Button variant="ghost">`.
2. **Tappable card / row** (`TAPPABLE_HOVER`): the whole card or row is one click target (`EntityCard`, search rows, profile external links). Neutral at rest; on hover the border turns accent and the title picks up `group-hover:text-orange-400` (put `group` on the row).
3. **Buttons** (`<Button>`): every action, shape and colour in one unit at one size; a `<Link>` that must look like one takes `buttonClasses(variant)`. Full vocabulary under [Buttons](#buttons).
4. **Pills / chips / badges** (`<Pill>`): the whole badge family in one `tone`: `accent` (open / detected / selected), `neutral` (default / tag / closed / inactive), `danger` (revoked / error), `strong` (a completed end-state, neutral white, not green: completion isn't a win). A `<span>` by default; pass `onClick` and it becomes an interactive chip, the caller driving the tone off its active state. Domain wrappers (`StatusBadge` for the one unified event lifecycle, the invite `StatusChip`) map an enum to tone + icon + label; a bare tag is `<Pill tone="neutral">` inline, no wrapper.
5. **Active nav / row surface** (`ACCENT_SURFACE`): the bare accent paint (bg + text, no border) for a selected nav row or option (sidebar rows, a `SegmentedControl`'s active option, the accent icon circles on the import panel / detections entry). `<Pill>`'s accent tone composes this paint + a border, so a pill and an active nav item can't drift apart.

Constants (the pill tones live on `<Pill>` as `PILL_TONE`; these colour-only paints export from [`styles.ts`](../frontend/src/components/ui/styles.ts)): `ACCENT_SURFACE`, `TAPPABLE_HOVER`, `TEXT_LINK`, `WARNING_CALLOUT`. Writing a class string longer than ~3 Tailwind tokens for an accent element means a constant probably already fits.

## Layout

```
┌────┬─────────────────────────────────────────────┐
│    │  Filters │                    │   Detail    │
│rail│  panel   │        MAP         │   panel     │
│    │  (left)  │   (full screen)    │  on click   │
└────┴─────────────────────────────────────────────┘
```

- **Sidebar rail:** fixed left nav (logo, working surfaces, identity block); every page clears it via `PageFrame`'s `pl-14`
- **Map:** full-screen background on `/map`
- **Left panel:** filters, opaque, floating over the map
- **Right panel:** event detail, appears on click, dismissible

**Panels:** `neutral-900` opaque (no glass / blur), `border-neutral-700`, `rounded-lg`, `p-4`, floating above the map. Width ~240px (filters), ~380px (detail).

## Typography

- **Font:** system stack, `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Sizes:** titles `text-lg` (18px) max; body `text-sm` (14px); labels / meta `text-xs` (12px); micro (counters, badges) `text-[11px]`
- **Weights:** `font-medium` for titles, `font-normal` for everything else

## Map

- **Style:** CARTO Dark Matter (with labels), `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`; the light theme swaps its matched counterpart Positron, `.../gl/positron-gl-style/style.json` (see [Theme](#theme)), with a faint `sepia` on the canvas (`globals.css`) warming Positron's cool grey to match the warm light surfaces
- **Renderer:** MapLibre GL JS (vector tiles) with globe projection
- Map labels (cities, regions) are discreet light-gray
- Point geometry: default radius 6px, selected 7px + 2px white border; opacity 1.0 (points), 0.85 (clusters); pointer cursor on hover

## Components

### Build on shared primitives

Every UI element is a reusable primitive; compose from them, never hand-roll a one-off. If none fits a new need, the missing piece is added to [`components/ui/`](../frontend/src/components/ui) (or as a new `FORM_*` / `styles.ts` constant) and consumed from there, never inlined in a page. Growing the vocabulary with a new shared component is a maintainer decision (see [`AGENTS.md`](../AGENTS.md) → *Conventions*); reusing or extending an existing one is the default.

**Token or component?** A piece is a *component* when it owns shape or behaviour (`<Input>`, `<Pill>`, `<Button>`, `<Card>`); it stays a raw *class constant* when it is a single-element paint composed into someone else's markup (`FORM_LABEL`, `ACCENT_SURFACE`, `TAPPABLE_HOVER`). A constant that starts growing variants has crossed the line: promote it. Primitives join classes with [`cn`](../frontend/src/lib/cn.ts) (tailwind-merge) so a caller's `className` wins conflicts predictably; `<Button>` and `<Pill>` stay one size by design.

The vocabulary:

- **Labels.** `FORM_LABEL` is the uppercase label above a control (`LABEL_TEXT` is the same without `block`); [`<SectionHeading>`](../frontend/src/components/ui/SectionHeading.tsx) heads a form section (title + `?` + optional marker); [`<SectionEyebrow>`](../frontend/src/components/ui/SectionEyebrow.tsx) is the uppercase eyebrow over a page / panel / card section.
- **Media.** [`<MediaGallery>`](../frontend/src/components/ui/MediaGallery.tsx) is the detail-surface block (2-up `hero` grid on the page, stacked `thumbnail` tiles in the panel; videos postered via `#t=0.1`). The card-sized media slot is private to [`<EntityCard>`](../frontend/src/components/ui/EntityCard.tsx), its only consumer.
- **Controls.** [`<Switch>`](../frontend/src/components/ui/Switch.tsx) is the one boolean toggle (`md` settings rows, `sm` map filter rows; `as="span"` when a whole-row parent owns the click). [`<SegmentedControl>`](../frontend/src/components/ui/SegmentedControl.tsx) is the exclusive-choice bar (submit type, admin delete mode; `tone="danger"` for a destructive active option). `<Input icon>` overlays a leading icon (the search box).
- **Small assemblies.** [`<AuthorByline>`](../frontend/src/components/ui/AuthorByline.tsx) is "by @user + TrustBadge". [`<Dot>`](../frontend/src/components/ui/Dot.tsx) is the accent notification dot. [`<EmptyState>`](../frontend/src/components/ui/EmptyState.tsx) owns the empty-state grammar (`boxed` / `plain` / `invite`). The anchored-popover machinery (pin, hover, outside-click / Escape dismiss, portal + viewport clamp) is [`usePinnedPopover`](../frontend/src/hooks/usePinnedPopover.ts), shared by `FieldHelp` and `TrustBadge`.
- **Live progress.** [`<ProgressSteps>`](../frontend/src/components/ui/ProgressSteps.tsx) is the vertical stepper for a live multi-step operation (the archive import): check for done, highlighted disc for the active step, muted for pending. Bars are honest by construction: a determinate bar renders only when a real 0..1 `progress` ratio exists; a step in flight without one takes a discreet `spinner` next to its label, never a fake animation. `keepDetail` pins a step's detail line after completion (a privacy guarantee, a final count). `failed` turns the active step into the red failure marker; the message itself stays in the form's `FORM_ERROR_BANNER`.

### Page chrome

Every main-app page uses [`<PageShell>`](../frontend/src/components/ui/PageShell.tsx), which owns the `title` / `subtitle` / `back` slots:

| Element | Style | Notes |
|---|---|---|
| Column | `max-w-4xl mx-auto px-6 pt-10 pb-16 space-y-6` | One width across the app. The offset + column (`pl-14` + `max-w-4xl mx-auto px-6`) come from [`<PageFrame>`](../frontend/src/components/ui/PageFrame.tsx), which PageShell composes and the public landing uses directly, so both share the same left inset. |
| H1 (`title`) | `text-xl font-medium text-neutral-100` | Consistent on every page. |
| Subtitle | `text-sm text-neutral-400` | Tight under the H1 (8 px gap). |
| Back arrow (`back`) | `absolute right-full top-1.5 mr-3 …` | Lives in the gutter so the title's x-coordinate is the same whether back is present or not. **When to set it:** `back` marks a drill-in page reached from content (event / request detail, edit, profile, the detections queue), where "back" means "return to where I clicked this". Sidebar destinations (map, search, requests, timeline, submit, settings, about) never set it: they are entered from the rail, so there is no "where I came from" to promise. |

Pre-data states use `<PageLoading>` / `<PageError>` (one centered shell). Opt-outs: `/` (landing), `/map` (full-screen map), the `(auth)/*` group, and `app/error.tsx`. The `(auth)/*` group composes [`<AuthCard>`](../frontend/src/components/auth/AuthCard.tsx) (a `max-w-sm` centered card); the two single-email pages (`/forgot-password`, `/resend-confirmation`) also share [`<SingleEmailFlow>`](../frontend/src/components/auth/SingleEmailFlow.tsx), whose sent-state copy stays anti-enumeration ("if X is registered…", never confirming the address exists).

### Buttons

One primitive: [`<Button>`](../frontend/src/components/ui/Button.tsx), shape and colour in a single unit at one size (no size scale). Four variants on two axes, tone (accent or danger) and emphasis (filled, outline, text):

- `primary`: accent, filled. The one main action of a view.
- `secondary`: accent, outline. A secondary action (edit, search, pagination).
- `ghost`: accent, text only. The quiet tier: cancel, dismiss, dense row actions, and (with `icon`) icon-only buttons.
- `danger`: red, outline. A destructive action (delete, revoke, reject), quiet on purpose.

Every clickable is accent, red is only destructive, there is no grey button (grey lives in `<Pill>` neutral and `disabled`). The one loud filled red is `DANGER_CONFIRM`, applied via `className` to the armed second click of a two-click confirm, so the strongest red shows once, at the point of no return. `fullWidth` stretches it (auth submits); `icon` makes a square icon-only button; a `<Link>` that should look like a button takes `buttonClasses(variant)`.

### Forms

**One submit page, content-gated.** [`/submit`](../frontend/src/app/submit/page.tsx) is a single form: you fill what you have, and two actions publish from the content, "Publish geolocation" (born `geolocated`) or "Publish request" (born `requested`), each gated on a live requirements tick-list that escalates from the request floor to the full geolocation floor. A "Start from" chooser picks a single event (blank or pre-filled from an X post) or the bulk archive import. `/requests/new` and the old `/geolocations/new` redirect here. Fulfilling a request (`?request_id=`) is always a geolocation.

Section order mirrors the detail page: Title → **Source media** → **Location** → Details (event date, source post time, source URL) → Tags → Proof. Request mode drops Location and Proof and makes dates optional. Each section is a `<Card as="section">` headed by [`<SectionHeading>`](../frontend/src/components/ui/SectionHeading.tsx) (which carries the section `?`); fields are the [`<Input>`](../frontend/src/components/ui/Input.tsx) primitive. **Source media** wraps the shared [`MediaManager`](../frontend/src/components/geolocations/MediaManager.tsx) (on the generic [`FileManager`](../frontend/src/components/ui/FileManager.tsx)), reused by submit and detection-submit so they can't drift. A geolocation also gets an import strip: **pre-fill from an X post** ([`TweetImportBanner`](../frontend/src/components/event/TweetImportBanner.tsx)) or **import your X archive** ([`ImportArchivePanel`](../frontend/src/components/geolocations/ImportArchivePanel.tsx)).

**Required by default.** Only exceptions carry an `optional` marker; nothing carries a `required` marker, so the form doesn't read as "only tags are mandatory". On submit, [`IncompleteFormNotice`](../frontend/src/components/ui/IncompleteFormNotice.tsx) lists every unmet field at once (not the first miss) above the action and outlines each missing field in place (`FORM_INVALID_FIELD`); the forms set `noValidate` so this notice, not native one-bubble-at-a-time validation, owns the feedback. It is shared across geolocation / request / detection submit, each computing its own required set (detection a superset of create, request a subset). One content rule: a geolocation's proof must contain an image (`proofHasImage`), the source ↔ satellite cross-reference. Detection-submit is a single **Submit** behind a confirm: a `detected` row is immutable machine output, so submit applies the whole form and freezes it as `geolocated` in one irreversible step.

### Field help (`?`)

[`FieldHelp`](../frontend/src/components/ui/FieldHelp.tsx) puts a `?` next to a field label, section heading, or detail row: a one-line explanation on hover / focus, pinned on click (touch can't hover), dismissed by outside-click or Escape (a real `role="tooltip"`, not a CSS `title`). It is **neutral grey, not accent** (meta help), the one sanctioned exception to clickable ⇒ accent. Each `?` is `<FieldHelp concept="…" />`; the concept registry [`lib/fieldHelp.ts`](../frontend/src/lib/fieldHelp.ts) pairs each concept's `text` + `label` once (wording mirrors [`data-model.md`](data-model.md)), so the same concept explains a field on the submit form, the detail page / map panel, and the filter panel without drift. Sections carry no always-on subtitle, so the `?` is the single source of section help; readers can hide every `?` via Settings → Display (per-browser), leaving just labels and fields.

### Status dots and badges

- The accent "new content awaits" dot is [`<Dot>`](../frontend/src/components/ui/Dot.tsx): sidebar nav badges (via `notify`), the landing / closed-beta pills, the detections entry. Position, ring, and size come via `className`.
- Inline marks next to author handles use a dedicated atom like [`profile/TrustBadge.tsx`](../frontend/src/components/profile/TrustBadge.tsx).

### Sanctioned one-offs

Decided once, so review doesn't re-litigate them:

- **Search's `UserResult`** re-declares `EntityCard`'s shell: folding it in would leak avatar / no-thumbnail conditionals into `EntityCard` for one consumer. Commented at the call site.
- **`ProofSection`** composes `<Card className="p-4">`, one density step tighter than the `p-5` form cards, because proof is a reading surface.
- **Admin dev tooling** ([`admin/DevToolPanel.tsx`](../frontend/src/components/admin/DevToolPanel.tsx), [`admin/ActionReceipt.tsx`](../frontend/src/components/admin/ActionReceipt.tsx)) is a deliberately lighter register than `<Card as="section">`, admin-local on purpose: admin-only surfaces don't earn `ui/` primitives.

## What we avoid

- Heavy glow, neon, pulse effects
- Gradients
- Glass / blur
- Decorative icons
- Long or showy animations
- Too many distinct colours; one accent hue only
- Information overload on the default view

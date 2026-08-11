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
- **Renderer:** MapLibre GL JS (vector tiles) with globe projection; zoom floor 1.8 (`MIN_ZOOM` in [`Map.tsx`](../frontend/src/components/map/Map.tsx)), the lowest level that keeps the globe fully visible once without shrinking it into void
- **One map stack.** Every map on the site is the same [`<Map>`](../frontend/src/components/map/Map.tsx): the full-screen canvas, the single pin on an event page, and the profile coverage map. A page whose view comes from its own content passes `fitBounds` (a `MapBounds`, from `pointsBounds` in [`bounds.ts`](../frontend/src/components/map/bounds.ts)) instead of `center` / `zoom`, and MapLibre solves the camera against the real container, capped at zoom 9 so a lone point lands on a regional read rather than a street. `pointsBounds` encloses longitude on the shorter arc (the complement of the widest empty gap), so work either side of the antimeridian frames tight instead of as a world view; a box across the seam comes back unwrapped, with `east` past 180. `MapBounds` is the one bounds shape, framing and request alike, and the `?bbox=` wire format has one home: [`lib/viewport.ts`](../frontend/src/lib/viewport.ts), whose `toBboxParam` rounds outward and widens an unwrapped crossing box to the full longitude range, which is what `parse_bbox` accepts
- Map labels (cities, regions) are discreet light-gray
- Point geometry: default radius 6px, selected 7px + 2px white border; opacity 1.0 (points), 0.85 (clusters); pointer cursor on hover
- **Pin hover preview.** Hovering any single unclustered pin (or a ring dot, below) shows one shared preview card after a 150 ms hover-intent delay (`PinPreviewCard` in [`Map.tsx`](../frontend/src/components/map/Map.tsx)): title, `StatusBadge`, the fixed `MediaThumb` slot (the picked card thumbnail, or its "no media" box), date and `AuthorByline`, composed on `Card`. The event detail is fetched only once the hover intent elapses (`GET /events/{id}`, bounded in-memory cache that also holds in-flight requests, stale responses ignored, a failed fetch shows a terse fallback) and the card clamps against the map edges after measuring, flipping left of the pin when the right side lacks room, so it always renders fully visible. Ordinary clusters get no preview. Touch has no hover; tap keeps opening the panel.
- **Co-located events: counted badge + hover fan-out.** Several events can share one coordinate (repeated strikes on a site, re-imported posts); their cluster can never expand. Points are grouped client-side on a ~1 m epsilon grid with neighbor-cell merging, so a stack straddling a grid line still reads as one (`groupStacks`, [`stack.ts`](../frontend/src/components/map/stack.ts)); past the clustering ceiling the group renders as **one counted badge** with the exact same colour, radius, opacity and count text as a small cluster, so cluster to stack reads as the same object across the whole zoom journey (a stack of 3 never masquerades as a single pin), while cluster counts below the ceiling stay true. Hovering the badge (or an unexpandable cluster, leaves within `STACK_EPSILON` via `getClusterLeaves`) splits it into a small ring of 12px dots around the shared center (`SpiderRing`: DOM dots, radius 18px growing only past ~7 events, capped at 24 dots: a larger stack fans out its first 23 events and fills the last slot with a "+N" overflow marker, the badge count staying the true total); the badge disappears underneath and the dots travel out from the center (and back on close before it reappears). Dot colours keep the point semantics above (detected shade vs base, selected halo; the badge carries the halo when it holds the selected event). Hovering a dot shows the pin preview; clicking it opens the event exactly like a normal pin. The ring collapses when the pointer leaves it (grace margin), on wheel, or when the map moves; tapping the badge or cluster opens the same ring on touch. Ordinary clusters keep their zoom-on-click behavior.
- **Cluster to points crossfade.** The map sets `fadeDuration: 0`: MapLibre otherwise holds an outgoing tile for a 300 ms symbol fade in which the tile's circles stop rendering but its labels keep drawing, so every cluster recompute left count labels floating without their circles (and reformed circles briefly count-less). At zero, labels and circles swap on the same frame; the cost is that basemap place labels pop in instead of fading. Count labels also skip symbol placement (`text-allow-overlap` + `text-ignore-placement`), so a count is never collision-culled independently of its circle. Around the clustering ceiling the swap is a zoom-interpolated opacity crossfade in paint expressions (the band's stops derive from `CLUSTER_MAX_ZOOM`: clusters and their counts thin approaching one zoom past the ceiling, points and stack badges rise just past it), applied **only while a zoom is in flight**: at rest every layer holds its full opacity, so a camera parked inside the band never sits washed out. A cluster click that resolves past the ceiling overshoots the band so the revealed pins land at full opacity.

## Components

### Build on shared primitives

Every UI element is a reusable primitive; compose from them, never hand-roll a one-off. If none fits a new need, the missing piece is added to [`components/ui/`](../frontend/src/components/ui) (or as a new `FORM_*` / `styles.ts` constant) and consumed from there, never inlined in a page. Growing the vocabulary with a new shared component is a maintainer decision (see [`AGENTS.md`](../AGENTS.md) → *Conventions*); reusing or extending an existing one is the default.

**Token or component?** A piece is a *component* when it owns shape or behaviour (`<Input>`, `<Pill>`, `<Button>`, `<Card>`); it stays a raw *class constant* when it is a single-element paint composed into someone else's markup (`FORM_LABEL`, `ACCENT_SURFACE`, `TAPPABLE_HOVER`). A constant that starts growing variants has crossed the line: promote it. Primitives join classes with [`cn`](../frontend/src/lib/cn.ts) (tailwind-merge) so a caller's `className` wins conflicts predictably; `<Button>` and `<Pill>` stay one size by design.

The vocabulary:

- **Labels.** `FORM_LABEL` is the uppercase label above a control (`LABEL_TEXT` is the same without `block`); [`<SectionHeading>`](../frontend/src/components/ui/SectionHeading.tsx) heads a form section (title + `?`); [`<SectionEyebrow>`](../frontend/src/components/ui/SectionEyebrow.tsx) is the uppercase eyebrow over a page / panel / card section.
- **Media.** [`<MediaGallery>`](../frontend/src/components/ui/MediaGallery.tsx) is the detail-surface block (2-up `hero` grid on the page, stacked `thumbnail` tiles in the panel; videos postered via `#t=0.1`). The card-sized media slot is private to [`<EntityCard>`](../frontend/src/components/ui/EntityCard.tsx), its only consumer. Every card / preview thumbnail (events list, profile feed, timeline, search hits, map pin hover, detections queue) is the backend-picked media: the `source` attachment, else the first `proof` image, never a proof video. The pick has one home, `backend/app/services/thumbnails.py`; the frontend renders what the payload carries and never re-derives it.
- **Controls.** [`<Switch>`](../frontend/src/components/ui/Switch.tsx) is the one boolean toggle (`md` settings rows, `sm` map filter rows; `as="span"` when a whole-row parent owns the click). [`<SegmentedControl>`](../frontend/src/components/ui/SegmentedControl.tsx) is the exclusive-choice bar (submit type, admin delete mode; `tone="danger"` for a destructive active option). `<Input icon>` overlays a leading icon (the search box). [`<LinkListInput>`](../frontend/src/components/ui/LinkListInput.tsx) is the ordered list of URL fields (the submit / edit forms' Secondary sources): one `<Input>` per row with a per-row remove, an add button that disables at its `max`, and a `locked` read-only mode.
- **Copy.** [`<CopyButton>`](../frontend/src/components/ui/CopyButton.tsx) is the one copy-to-clipboard control: a square ghost icon button whose copy glyph flips to a check for the flash window. `value` is a getter, resolved at click time, so a call site reads `window` without a render-time branch; `beforeCopy` gates the write (the event share row arms a draft link on the first click) and `className` carries the armed ring. The accessible name is static and the copied state lands in a sibling live region, so the control reports a status instead of renaming itself. The clipboard write and the flash timer are one hook, [`useCopyToClipboard`](../frontend/src/hooks/useCopyToClipboard.ts), which the admin invite row uses directly for its own text-button shape.
- **Small assemblies.** [`<AuthorByline>`](../frontend/src/components/ui/AuthorByline.tsx) is "by @user"; `avatar` leads with the author's picture instead of the "by " prefix (picture + handle already read as a signature), on the detail pages and the map side-panel header. [`<Dot>`](../frontend/src/components/ui/Dot.tsx) is the accent notification dot. [`<EmptyState>`](../frontend/src/components/ui/EmptyState.tsx) owns the empty-state grammar (`boxed` / `plain` / `invite`). The anchored-popover machinery (pin, hover, outside-click / Escape dismiss, portal + viewport clamp) is [`usePinnedPopover`](../frontend/src/hooks/usePinnedPopover.ts), used by `FieldHelp`.
- **Instruction lists.** [`<NumberedSteps>`](../frontend/src/components/ui/NumberedSteps.tsx) is the static "1, 2, 3…" list (numbered disc + title + body): `plain` on the two public guides, `boxed` with a per-step icon for the archive export walkthrough on `/submit`. Every step looks the same because it is reference copy, not state; a check mark or a spinner means you want `<ProgressSteps>` below instead.
- **Live progress.** [`<ProgressSteps>`](../frontend/src/components/ui/ProgressSteps.tsx) is the vertical stepper for a live multi-step operation (the archive import): check for done, highlighted disc for the active step, muted for pending. Bars are honest by construction: a determinate bar renders only when a real 0..1 `progress` ratio exists; a step in flight without one takes a discreet `spinner` next to its label, never a fake animation. `keepDetail` pins a step's detail line after completion (a privacy guarantee, a final count). `failed` turns the active step into the red failure marker; the message itself stays in the form's `FORM_ERROR_BANNER`.

### Page chrome

Every main-app page uses [`<PageShell>`](../frontend/src/components/ui/PageShell.tsx), which owns the `title` / `subtitle` / `back` / `actions` slots:

| Element | Style | Notes |
|---|---|---|
| Column | `max-w-4xl mx-auto px-6 pt-10 pb-16 space-y-6` | One width across the app. The offset + column (`pl-14` + `max-w-4xl mx-auto px-6`) come from [`<PageFrame>`](../frontend/src/components/ui/PageFrame.tsx), which PageShell composes and the public landing uses directly, so both share the same left inset. |
| H1 (`title`) | `text-xl font-medium text-neutral-100` | Consistent on every page. |
| Subtitle | `text-sm text-neutral-400` | Tight under the H1 (8 px gap). |
| Back arrow (`back`) | `absolute right-full top-1.5 mr-3 …` | Lives in the gutter so the title's x-coordinate is the same whether back is present or not. **When to set it:** `back` marks a drill-in page reached from content (event / request detail, edit, profile, the detections queue), where "back" means "return to where I clicked this". Sidebar destinations (map, submit, requests, search, about, settings) never set it: they are entered from the rail, so there is no "where I came from" to promise. |
| Actions (`actions`) | Right of the title, wrapping under it below a `14rem` title basis | The page-level action cluster (the event share row, the profile share + follow / edit pair). Flex line-breaking measures the title's base size, so the cluster takes its own line rather than squeezing a heading into a one-word column. A preference, not a minimum (`min-w-0`): a hard floor outgrows the frame on the narrowest phones and scrolls the page sideways. The subtitle breaks anywhere, since the owner's email is one unbreakable token. |

Pre-data states use `<PageLoading>` / `<PageError>` (one centered shell). Opt-outs: `/` (landing), `/map` (full-screen map), the `(auth)/*` group, and `app/error.tsx`. The public guides sit on the same shell, signed out included: `/guide` ("How Vidit works", the whole loop from reading the map to publishing), `/methodology` ("Building a proof"), and `/bot` (the mention format), each a server component of `PageShell` + `Card` for SEO, hubbed from the About page's Guides section. The `(auth)/*` group composes [`<AuthCard>`](../frontend/src/components/auth/AuthCard.tsx) (a `max-w-sm` centered card); the two single-email pages (`/forgot-password`, `/resend-confirmation`) also share [`<SingleEmailFlow>`](../frontend/src/components/auth/SingleEmailFlow.tsx), whose sent-state copy stays anti-enumeration ("if X is registered…", never confirming the address exists).

### Public profile

[`/profile/{username}`](../frontend/src/app/profile/[username]/page.tsx) is an analyst's portfolio, the page they can pin as their link, so it is ordered as evidence rather than as an account:

1. **Header.** The handle is the H1, with the avatar beside it (`ProfileTitle`, [`ProfileHeader.tsx`](../frontend/src/components/profile/ProfileHeader.tsx)) and the action cluster in PageShell's `actions`: the copy-link control on every profile, then Follow (someone else's) or the edit / save pair (your own). The owner's email is the subtitle. Same grammar as the event detail page, which also titles itself with the thing it is about and puts sharing in `actions`.
2. **Bio**, the analyst's own framing.
3. **Counts strip** (`ProfileStats`): submitted, followers, following, member since. A `<StatGrid>` of four tiles, always rendered.
4. **Insights** (`ProfileInsights`): the shape-of-work card from `GET /users/{username}/stats`, its own second `<StatGrid>` (status split, media) plus top conflicts, capture sources and the 12-month activity bars. Hidden entirely for a profile with no events, so the strip above is what a new account shows.
5. **Coverage**: their geolocations on a map (`ProfileMap`), the shared `<Map>` fed by `/events/points?author=…` with an explicit world `bbox` (`WORLD_BOUNDS` serialised through `toBboxParam`, the endpoint requiring one), camera fitted to the returned points. Published work only: `hide_demo` drops the demo pool and the payload is narrowed to `geolocated`, so machine drafts neither move the camera nor enter the count beside the heading. Hidden when the analyst has no located events.
6. **Recent submissions**, then **linked accounts** (any visitor, whenever the profile carries links), then the owner-only blocks (the detections queue entry, sign out).

Editing collapses that order. While the owner is editing, the page renders the header fields, the bio and the linked-accounts inputs and nothing else: the read-only sections drop out for the duration, so every field sits between the header and the Save button in `actions`.

The copy-link control is the shared [`<CopyButton>`](../frontend/src/components/ui/CopyButton.tsx), the same primitive as the event share row.

### Buttons

One primitive: [`<Button>`](../frontend/src/components/ui/Button.tsx), shape and colour in a single unit at one size (no size scale). Four variants on two axes, tone (accent or danger) and emphasis (filled, outline, text):

- `primary`: accent, filled. The one main action of a view.
- `secondary`: accent, outline. A secondary action (edit, search, pagination).
- `ghost`: accent, text only. The quiet tier: cancel, dismiss, dense row actions, and (with `icon`) icon-only buttons.
- `danger`: red, outline. A destructive action (delete, revoke, reject), quiet on purpose.

Every clickable is accent, red is only destructive, there is no grey button (grey lives in `<Pill>` neutral and `disabled`). The one loud filled red is `DANGER_CONFIRM`, applied via `className` to the armed second click of a two-click confirm, so the strongest red shows once, at the point of no return. `fullWidth` stretches it (auth submits); `icon` makes a square icon-only button; a `<Link>` that should look like a button takes `buttonClasses(variant)`.

### Forms

**One submit page, content-gated.** [`/submit`](../frontend/src/app/submit/page.tsx) is a single form: you fill what you have, and two actions publish from the content, "Publish geolocation" (born `geolocated`) or "Publish request" (born `requested`), each gated on a live requirements tick-list that escalates from the request floor to the full geolocation floor. A "Start from" chooser picks the entry path: **Single** (one event by hand), **From an X post** (the same form, front-loaded with the import banner), or **Bulk import** (the archive on-ramp, which swaps in for the form). `/requests/new` and the old `/geolocations/new` redirect here. Fulfilling a request (`?request_id=`) is always a geolocation.

Section order mirrors the detail page: Title → **Source media** → **Location** → Details (event date, source post time, source URL, secondary sources) → Tags → Proof. Request mode drops Location and Proof and makes dates optional. Each section is a `<Card as="section">` headed by [`<SectionHeading>`](../frontend/src/components/ui/SectionHeading.tsx) (which carries the section `?`); fields are the [`<Input>`](../frontend/src/components/ui/Input.tsx) primitive. **Source media** wraps the shared [`MediaManager`](../frontend/src/components/geolocations/MediaManager.tsx) (on the generic [`FileManager`](../frontend/src/components/ui/FileManager.tsx)), reused by submit and detection-submit so they can't drift. The **From an X post** mode heads the form with [`TweetImportBanner`](../frontend/src/components/event/TweetImportBanner.tsx): paste your own geolocation post and the fields come back filled. Once an import has landed the banner stays rendered in **Single** too, since it carries the provenance, the authorship warning and Clear. **Bulk import** is [`ImportArchivePanel`](../frontend/src/components/geolocations/ImportArchivePanel.tsx), whose export walkthrough is a `boxed` [`NumberedSteps`](../frontend/src/components/ui/NumberedSteps.tsx).

**Required by default.** No field carries a `required` or an `optional` marker: per-field markers turned the form into a legend to decode, and two guides already say the same thing better. The readiness tick-list under the actions names every unmet requirement of the publish path you are aiming at, and a clicked action outlines the missing fields in place. On submit, [`IncompleteFormNotice`](../frontend/src/components/ui/IncompleteFormNotice.tsx) lists every unmet field at once (not the first miss) above the action and outlines each missing field in place (`FORM_INVALID_FIELD`); the forms set `noValidate` so this notice, not native one-bubble-at-a-time validation, owns the feedback. It is shared across geolocation / request / detection submit, each computing its own required set (detection a superset of create, request a subset). One content rule: a geolocation's proof must contain an image (`proofHasImage`), the source ↔ satellite cross-reference. Detection-submit is a single **Submit** behind a confirm: a `detected` row is immutable machine output, so submit applies the whole form and freezes it as `geolocated` in one irreversible step.

### Field help (`?`)

[`FieldHelp`](../frontend/src/components/ui/FieldHelp.tsx) puts a `?` next to a field label, section heading, or detail row: a one-line explanation on hover / focus, pinned on click (touch can't hover), dismissed by outside-click or Escape (a real `role="tooltip"`, not a CSS `title`). It is **neutral grey, not accent** (meta help), the one sanctioned exception to clickable ⇒ accent. Each `?` is `<FieldHelp concept="…" />`; the concept registry [`lib/fieldHelp.ts`](../frontend/src/lib/fieldHelp.ts) pairs each concept's `text` + `label` once (wording mirrors [`data-model.md`](data-model.md)), so the same concept explains a field on the submit form, the detail page / map panel, and the filter panel without drift. Sections carry no always-on subtitle, so the `?` is the single source of section help; readers can hide every `?` via Settings → Display (per-browser), leaving just labels and fields.

### Status dots and badges

- The accent "new content awaits" dot is [`<Dot>`](../frontend/src/components/ui/Dot.tsx): sidebar nav badges (via `notify`) and the rail's identity row when drafts are pending, the profile's detections entry, and the map filter panel's in-flight pulse. Position, ring, and size come via `className`.

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

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { useAdmin } from "@/hooks/useAdmin";
import { ACCENT_SURFACE } from "@/components/ui/styles";
import { ICON_TAP_STEP } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Dot } from "@/components/ui/Dot";
import {
  DiscordGlyph,
  GitHubGlyph,
  XGlyph,
} from "@/components/ui/BrandGlyphs";
import BetaBanner from "@/components/BetaBanner";
import { setPhoneBackSlot } from "@/lib/phoneBackSlot";
import {
  Globe,
  Plus,
  Settings,
  Search,
  Info,
  LogIn,
  Megaphone,
  Swords,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";

const X_URL = "https://x.com/vidithq";
const DISCORD_URL = "https://discord.gg/9wPtsrrKyJ";
const GITHUB_URL = "https://github.com/vidithq/vidit";

// Fixed-height row for every nav item and the toggle, so icons keep their y whether collapsed or
// expanded. `shrink-0` makes `h-9` hold inside the scrolling nav: a flex child otherwise squashes
// on a short viewport instead of scrolling.
const ROW_CLASS =
  "flex items-center gap-2.5 h-9 shrink-0 rounded-md px-2.5 text-sm transition-colors";

// The three community links on the header row. `ICON_TAP_STEP` is the phone floor for small icon
// controls: 28px suits a mouse, not a thumb, and below `sm` the row is in the drawer.
const BRAND_LINK_CLASS = `${ICON_TAP_STEP} sm:size-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-100 hover:bg-neutral-800 transition-colors`;

// Must match the aside's `duration-200` width transition. Labels render only after it, else they
// overflow the narrow sidebar and flicker.
const EXPAND_TRANSITION_MS = 200;

const NAV_ID = "primary-navigation";

// The `sm` breakpoint as a media query: the drawer exists only below it, so crossing upward must drop it.
const SM_QUERY = "(min-width: 40rem)";

interface NavItem {
  href: string;
  icon: typeof Globe;
  label: string;
  auth?: boolean;
  // Custom active matcher so deep pages inherit their section's highlight (/events/[id] keeps Map
  // lit). Defaults to exact `href`.
  activeFor?: (pathname: string) => boolean;
}

// Order: Map, Submit, Requests, Search, About (public/meta plus the guides hub) last. Timeline is
// off the rail until its collaboration mechanics arrive; the bot guide is reached from About and
// X itself. Home has no slot (the logo links it). Only Submit carries `auth: true` and hides
// signed-out. Profile, Settings, Sign-in and Sign-out are the identity block at the bottom.
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  {
    href: "/map",
    icon: Globe,
    label: "Map",
    // Exactly /events/<id> (one segment) keeps the Map highlight; sub-routes like /events/<id>/edit don't.
    activeFor: (p) => p === "/map" || /^\/events\/[^/]+$/.test(p),
  },
  { href: "/submit", icon: Plus, label: "Submit", auth: true },
  {
    href: "/requests",
    icon: Megaphone,
    label: "Requests",
    activeFor: (p) => p === "/requests" || p.startsWith("/requests/"),
  },
  { href: "/search", icon: Search, label: "Search" },
  {
    href: "/about",
    icon: Info,
    label: "About",
    // About is the guides hub, so it stays lit on them like Map on an event detail.
    activeFor: (p) =>
      p === "/about" ||
      p === "/guide" ||
      p === "/methodology" ||
      p === "/import",
  },
];

// The identity block's plain rows, through the same `renderNavItem` as the rail so the treatment
// can't drift. Each is gated at its render site; the profile row alone is bespoke (avatar,
// pending-detections dot).
const ADMIN_ITEM: NavItem = { href: "/admin", icon: Swords, label: "Admin" };
const SIGN_IN_ITEM: NavItem = { href: "/login", icon: LogIn, label: "Sign in" };
const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  icon: Settings,
  label: "Settings",
};

function isActive(item: NavItem, pathname: string): boolean {
  return item.activeFor ? item.activeFor(pathname) : pathname === item.href;
}

export default function Sidebar() {
  // The desktop rail's pinned width, from `sm` up: the toggle, rail width and label lag. Nothing phone-related reads it.
  const [expanded, setExpanded] = useState(false);
  // The phone drawer: only the chip's button (`sm:hidden`) opens it.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Lags `expanded` when growing (labels appear after the width animates), leads it when shrinking.
  const [labelsVisible, setLabelsVisible] = useState(false);
  // The drawer's label gate, mirror of `labelsVisible`: raised with `drawerOpen` (the drawer is 192px
  // from the first frame), lowered a transition after close so rows keep their text through the
  // 200ms slide out.
  const [drawerLabels, setDrawerLabels] = useState(false);
  // The nav element (focus moves into it on open) and the previously focused element (restored on close).
  const navRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname() ?? "";
  const { user, loading } = useAuth();
  const { isAdmin } = useAdmin();
  const { count: detectionCount } = useDetectionsCount();

  useEffect(() => {
    if (expanded) {
      const t = setTimeout(() => setLabelsVisible(true), EXPAND_TRANSITION_MS);
      return () => clearTimeout(t);
    }
    // Collapsing: hide labels in the render that starts the transition, so they're gone before the bar narrows.
    setLabelsVisible(false);
  }, [expanded]);

  // Closing only: hold the labels for the slide out so the drawer leaves whole. The opener raises
  // the gate on its own click.
  useEffect(() => {
    if (drawerOpen) return;
    const t = setTimeout(() => setDrawerLabels(false), EXPAND_TRANSITION_MS);
    return () => clearTimeout(t);
  }, [drawerOpen]);

  // The one viewport read here: the drawer is state and CSS cannot clear state. A viewport crossing
  // `sm` upward (rotation, window widening) would leave `drawerOpen` true behind the rail, with the
  // body scroll-locked and Escape armed.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(SM_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawerOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Focus follows the drawer: into the first nav row on open, back to the opener on close, so
  // keyboard and screen-reader users never sit behind the scrim. Page content under the scrim is
  // not `inert` (that needs a wrapper this component does not own), so focus can still Tab out.
  useEffect(() => {
    if (drawerOpen) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const first = navRef.current?.querySelector("a");
      if (!first) return;
      first.focus();
      // The drawer transitions `visibility` with its transform, and a still-hidden element refuses
      // focus: at progress 0 it holds the old value, so success depends on effect timing. One retry on
      // the next frame (always past 0) covers it.
      if (document.activeElement === first) return;
      const raf = requestAnimationFrame(() => first.focus());
      return () => cancelAnimationFrame(raf);
    }
    const previous = restoreFocusRef.current;
    restoreFocusRef.current = null;
    // Only after an open: on first render there is nothing to restore, and stealing focus would fight the page.
    if (previous) (openerRef.current ?? previous).focus();
  }, [drawerOpen]);

  // A navigation closes the drawer, since the destination renders behind it. The aside's click
  // handler covers taps inside; this catches redirects and the back button. Closing a closed drawer
  // is a no-op.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // While the drawer is open: Escape closes it and the page under the scrim doesn't scroll.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  // Suppressed only during the initial auth load, to avoid flashing the signed-out nav.
  if (loading) return null;

  // Highlights only on /profile (redirects to {me}) and /profile/{me.username}: another analyst's
  // profile is not "your" account.
  const profileActive =
    !!user &&
    (pathname === "/profile" ||
      pathname === `/profile/${user.username}` ||
      pathname === `/profile/${user.username}/detections`);

  // The brand mark is the Home entry, so it lights like a nav row on `/`.
  const homeActive = pathname === "/";

  // The drawer is 192px wide whatever the rail's width, so it shows labels from the frame it opens
  // until the slide out ends. `labelsVisible` paces only the desktop width animation, `drawerLabels`
  // the drawer's. `drawerOpen` is included so a control added later that forgets the gate still shows labels.
  const showLabels = labelsVisible || drawerOpen || drawerLabels;

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item, pathname);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={!showLabels ? item.label : undefined}
        className={`${ROW_CLASS} overflow-hidden ${
          active
            ? ACCENT_SURFACE
            : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
        }`}
      >
        <Icon size={18} strokeWidth={active ? 2.2 : 1.8} className="shrink-0" />
        {showLabels && (
          <span className="truncate flex-1 animate-label-in">{item.label}</span>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Phone only: the rail's chrome while off-canvas. A floating chip top-left, 8px in, holding the
          open control and the page's back control; pages clear it with their own top padding
          (PageShell's `max-sm:pt-16`). Above the aside's z so the drawer, later in tree order, doesn't
          paint over it. */}
      <div className="sm:hidden fixed top-2 left-2 safe-mt safe-ml z-1150 flex items-center gap-0.5 rounded-md p-0.5 bg-neutral-900 border border-neutral-800">
        {/* Hand-rolled, not `<Button icon>`: a 44px neutral thumb target; the primitive offers one 36px
            square in accent or red. */}
        <button
          type="button"
          ref={openerRef}
          onClick={() => {
            setDrawerOpen(true);
            setDrawerLabels(true);
          }}
          aria-label="Open navigation"
          title="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls={NAV_ID}
          className="size-11 shrink-0 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
        >
          <Menu size={20} strokeWidth={1.8} />
        </button>
        {/* The back control's seat: `PageShell` portals its button in here on a page that has one, so the
            arrow rides the chip instead of taking a row. Empty elsewhere. */}
        <div
          id="phone-back-slot"
          className="flex items-center"
          ref={setPhoneBackSlot}
        />
      </div>

      {/* Phone only: tapping beside the open drawer closes it. Named apart from the foot button, which
          does the same thing from elsewhere, so a list of controls tells them apart. */}
      {drawerOpen && (
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation overlay"
          // z scale: map panels 1000, this scrim 1090, rail and drawer 1100, beta pill 1200, media lightbox 1500.
          className="sm:hidden fixed inset-0 z-1090 bg-black/50"
        />
      )}

      <aside
        id={NAV_ID}
        aria-label="Primary navigation"
        // Modal only as a drawer: it covers the page behind a scrim, which `dialog` + `aria-modal`
        // describe. From `sm` up it is a plain landmark and carries neither.
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen ? true : undefined}
        // Any link inside the drawer closes it. The route-change effect can't carry this alone: tapping
        // the already-active entry changes no pathname, leaving the drawer open and the body
        // scroll-locked. One handler, so a later row is wired by construction; closing a closed drawer
        // is a no-op.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setDrawerOpen(false);
        }}
        // `max-sm:invisible` takes the closed drawer out of the tab order; the transition carries
        // `visibility`, so it flips at the end of the slide out.
        //
        // The safe-area padding is the drawer's alone (`max-sm:`). The rail from `sm` up is a fixed 56px
        // border-box column, and a landscape phone is past `sm` (a notched 812px viewport matches it), so
        // the padding would take 44px of its 56px. The rail takes no inset: see docs/design.md, Phone chrome.
        className={`fixed top-0 left-0 h-screen z-1100 flex flex-col max-sm:safe-pt max-sm:safe-pb max-sm:safe-pl bg-neutral-900 border-r border-neutral-800 transition-[width] duration-200 max-sm:h-dvh max-sm:w-48 max-sm:transition-[transform,visibility] ${
          expanded ? "w-48" : "w-14"
        } ${
          drawerOpen
            ? "max-sm:translate-x-0 max-sm:visible"
            : "max-sm:-translate-x-full max-sm:invisible"
        }`}
      >
        {/* Community glyphs ride the right of the row when expanded (no room in the 56px collapsed rail).
            pt-3/pb-1 keep the mark tight against the rail. */}
        <div className="flex items-center gap-1 px-2 pt-3 pb-1 overflow-hidden">
          {/* The brand mark doubles as the Home entry: same row treatment as the items below. */}
          <Link
            href="/"
            title="Home"
            className={`${ROW_CLASS} ${
              homeActive
                ? ACCENT_SURFACE
                : "text-neutral-100 hover:bg-neutral-800"
            }`}
          >
            <span className="w-[18px] flex items-center justify-center shrink-0 text-orange-500 font-bold text-lg leading-none">
              V
            </span>
          </Link>
          {showLabels && (
            <div className="flex items-center gap-1 ml-auto pr-1 animate-label-in">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                title="Vidit on GitHub"
                aria-label="Vidit on GitHub"
                className={BRAND_LINK_CLASS}
              >
                <GitHubGlyph />
              </a>
              <a
                href={X_URL}
                target="_blank"
                rel="noopener noreferrer"
                title="Vidit on X"
                aria-label="Vidit on X"
                className={BRAND_LINK_CLASS}
              >
                <XGlyph />
              </a>
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                title="Vidit Discord"
                aria-label="Vidit Discord"
                className={BRAND_LINK_CLASS}
              >
                <DiscordGlyph />
              </a>
            </div>
          )}
        </div>

        {/* flex-1 pushes the bottom block down (a visual gap, not a border); the header's pb-1 sets the
            top gap. `min-h-0` lets this child shrink so the scroll falls here, not on the aside: on a
            320px-tall landscape phone the rows would push the identity block and foot controls out of reach. */}
        <nav
          ref={navRef}
          className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 px-2 pb-3"
        >
          {NAV_ITEMS.filter((item) => !item.auth || user).map(renderNavItem)}
        </nav>

        {/* Bottom block, one visual group, no border-t: the flex-1 spacer above separates it. */}
        <div className="flex flex-col gap-1 px-2 pb-3">
          {isAdmin && renderNavItem(ADMIN_ITEM)}
          {user ? (
            <Link
              href={`/profile/${user.username}`}
              title={
                !showLabels
                  ? detectionCount > 0
                    ? `${user.username} · ${detectionCount} to submit`
                    : user.username
                  : undefined
              }
              className={`${ROW_CLASS} overflow-hidden ${
                profileActive
                  ? ACCENT_SURFACE
                  : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
              }`}
            >
              {/* The analyst's own picture in the 18px rail glyph box. `<Avatar>` owns circle, image and icon
                  fallback; the wrapper anchors the badge. `text-current` keeps the fallback on the row colour
                  (hover, active); `decorative` keeps it out of the link's name, which stays the handle (plus
                  pending count) from `title`. */}
              <span className="relative flex shrink-0">
                <Avatar
                  as="span"
                  src={user.avatar_url}
                  username={user.username}
                  size="size-[18px]"
                  fallback="icon"
                  iconClassName="text-current"
                  decorative
                />
                {/* Pending-submission nudge, the rail's only badge. */}
                {detectionCount > 0 && (
                  <Dot className="absolute -top-0.5 -right-1 ring-2 ring-neutral-900" />
                )}
              </span>
              {showLabels && (
                <span className="truncate flex-1 animate-label-in">
                  {user.username}
                </span>
              )}
              {detectionCount > 0 && (
                <span className="sr-only">
                  {detectionCount} geolocations awaiting submission
                </span>
              )}
            </Link>
          ) : (
            renderNavItem(SIGN_IN_ITEM)
          )}

          {user && renderNavItem(SETTINGS_ITEM)}

          {/* The foot control, one row at every width but two buttons: below `sm` it closes the drawer, from
              `sm` up it folds the rail. They act on different state. */}
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
            className={`${ROW_CLASS} sm:hidden w-full overflow-hidden text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800`}
          >
            <X size={18} strokeWidth={1.8} className="shrink-0" />
            {showLabels && (
              <span className="truncate animate-label-in">Close</span>
            )}
          </button>
          {/* Icon tracks `expanded` (flips immediately on click); label tracks
              `labelsVisible` so it doesn't flicker mid-animation. */}
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={expanded}
            title={!labelsVisible ? "Expand sidebar" : undefined}
            className={`${ROW_CLASS} max-sm:hidden w-full overflow-hidden text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800`}
          >
            {expanded ? (
              <ChevronLeft size={18} strokeWidth={1.8} className="shrink-0" />
            ) : (
              <ChevronRight size={18} strokeWidth={1.8} className="shrink-0" />
            )}
            {labelsVisible && (
              <span className="truncate animate-label-in">Collapse</span>
            )}
          </button>

          {/* The corner pill hides on a phone, so the drawer carries the same build badge and bug-report link. */}
          <BetaBanner inline />
        </div>
      </aside>
    </>
  );
}

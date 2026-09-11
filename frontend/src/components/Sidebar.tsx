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

// Fixed-height row for every nav item, sign-in/out, and the toggle, so icons
// stay at the same y position whether collapsed or expanded. `shrink-0` makes
// `h-9` hold inside the scrolling nav below: a flex child shrinks past its
// height by default, so on a short viewport the rows would squash to a few
// pixels each instead of overflowing into a scroll.
const ROW_CLASS =
  "flex items-center gap-2.5 h-9 shrink-0 rounded-md px-2.5 text-sm transition-colors";

// The three community links on the header row, written once. `ICON_TAP_STEP`
// is the phone floor every small icon control takes: the resting 28px square
// is what a mouse needs and less than what a thumb hits, and below `sm` the
// row is inside the drawer, where the reader is using one.
const BRAND_LINK_CLASS = `${ICON_TAP_STEP} sm:size-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-100 hover:bg-neutral-800 transition-colors`;

// Must match the aside's `duration-200` width transition. Labels render only
// after the expand finishes, else they overflow the still-narrow sidebar mid-
// animation and flicker.
const EXPAND_TRANSITION_MS = 200;

// Ties the chip's open button to the aside it controls.
const NAV_ID = "primary-navigation";

// The `sm` breakpoint as a media query. The drawer is a shape the rail only
// takes below it, so a viewport that crosses upward has to drop it.
const SM_QUERY = "(min-width: 40rem)";

interface NavItem {
  href: string;
  icon: typeof Globe;
  label: string;
  auth?: boolean;
  // Custom active-state matcher so deep pages inherit their section's highlight
  // (e.g. /events/[id] keeps Map lit). Defaults to exact match on `href`.
  activeFor?: (pathname: string) => boolean;
}

// Map (the catalogue), Submit (add your work), Requests (the board), Search
// (the other lens on the catalogue), About (public/meta plus the guides hub)
// last. Every entry is a living surface: Timeline leaves the rail until its
// collaboration mechanics arrive, and the bot guide is reached from About and
// from X itself (bot bio, replies), where its readers actually come from.
// Home has no rail slot: the logo already links it, so a second entry was
// pure noise once signed in. Anonymous read is open, so only the write
// surface (Submit) carries `auth: true` and hides signed-out.
// Profile/Settings/Sign-in/Sign-out are a separate identity block at the bottom,
// not here.
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  {
    href: "/map",
    icon: Globe,
    label: "Map",
    // Match exactly /events/<id> (one segment) so a geolocation detail
    // keeps the Map highlight; sub-routes like /events/<id>/edit don't.
    // Submit lives at /submit now, so no carve-out is needed here.
    activeFor: (p) => p === "/map" || /^\/events\/[^/]+$/.test(p),
  },
  { href: "/submit", icon: Plus, label: "Submit", auth: true },
  {
    href: "/requests",
    icon: Megaphone,
    label: "Requests",
    // Every /requests/* path is a Requests page (creation lives at /submit).
    activeFor: (p) => p === "/requests" || p.startsWith("/requests/"),
  },
  { href: "/search", icon: Search, label: "Search" },
  {
    href: "/about",
    icon: Info,
    label: "About",
    // About is the hub for the guide pages (its Guides section links them),
    // so it stays lit on them, the same way Map stays lit on an event detail.
    activeFor: (p) =>
      p === "/about" ||
      p === "/guide" ||
      p === "/methodology" ||
      p === "/import",
  },
];

// The bottom identity block's plain rows, rendered through the same
// `renderNavItem` as the rail above so the row treatment can't drift. Each is
// gated at its render site (Admin on the role, Sign in on being signed out,
// Settings on being signed in); the profile row is the only bespoke one, since
// it carries an avatar and the pending-detections dot.
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
  // The desktop rail's pinned width, from `sm` up: the chevron toggle, the rail
  // width, and the label lag below. Nothing phone-related reads it.
  const [expanded, setExpanded] = useState(false);
  // The phone drawer, by construction: the only control that opens it is the
  // chip's button, and the chip is `sm:hidden`.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Lags `expanded` when growing (labels appear after width animates) and leads
  // it when shrinking, avoiding the mid-animation overflow flicker.
  const [labelsVisible, setLabelsVisible] = useState(false);
  // The drawer's label gate, the mirror image of `labelsVisible`: raised with
  // `drawerOpen` by the chip's button (the drawer is 192px wide from the first
  // frame, so its labels never overflow) and lowered a transition after it
  // clears, so the rows keep their text through the 200ms slide out instead of
  // blanking on the frame it starts.
  const [drawerLabels, setDrawerLabels] = useState(false);
  // The nav element, so opening the drawer can move focus into it, and the
  // element focused before it opened, so closing can hand focus back.
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
    // Collapsing: hide labels in the same render that starts the transition,
    // so they're gone before the bar narrows.
    setLabelsVisible(false);
  }, [expanded]);

  // Closing only: hold the labels for the slide out, so the drawer travels off
  // canvas whole instead of losing its text on the frame the transition starts.
  // Raising the gate is the opener's job, since it fires on the same click that
  // opens the drawer and so needs no render of its own.
  useEffect(() => {
    if (drawerOpen) return;
    const t = setTimeout(() => setDrawerLabels(false), EXPAND_TRANSITION_MS);
    return () => clearTimeout(t);
  }, [drawerOpen]);

  // The one deliberate viewport read in this file: every other rule here is a
  // `max-sm:` / `sm:` class, but the drawer is state, and CSS cannot clear
  // state. A viewport that crosses `sm` upward (a rotation, a desktop window
  // widening) would otherwise leave `drawerOpen` true behind the rail it just
  // became, with the body still scroll-locked and Escape still armed.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(SM_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawerOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Focus follows the drawer: into the first nav row when it opens, back to
  // the control that opened it when it closes, so a keyboard or screen-reader
  // reader is never left on an element behind the scrim. The page content
  // under the scrim is not `inert`: that needs a wrapper this component does
  // not own, so focus can still Tab out of the open drawer (remaining gap).
  useEffect(() => {
    if (drawerOpen) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const first = navRef.current?.querySelector("a");
      if (!first) return;
      first.focus();
      // The drawer transitions `visibility` alongside its transform, and a
      // still-hidden element refuses focus: at progress 0 the transition holds
      // the old value, so whether this frame is past 0 depends on when the
      // effect lands relative to the first paint. One retry on the next frame,
      // which is always past 0, covers the case where it was not.
      if (document.activeElement === first) return;
      const raf = requestAnimationFrame(() => first.focus());
      return () => cancelAnimationFrame(raf);
    }
    const previous = restoreFocusRef.current;
    restoreFocusRef.current = null;
    // Only after an open: on the first render there is nothing to restore, and
    // stealing focus then would fight whatever the page focused itself.
    if (previous) (openerRef.current ?? previous).focus();
  }, [drawerOpen]);

  // A navigation closes the drawer, since the destination renders behind it.
  // The aside's own click handler already closes on a tap inside the drawer;
  // this catches every other way out (a redirect, the browser's back button).
  // Closing a drawer that is already closed is a no-op, so this one needs no
  // viewport read of its own.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // While the drawer is open: Escape closes it, and the page under the scrim
  // stays put instead of scrolling behind it.
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

  // Suppressed only during the initial auth load, to avoid flashing the
  // signed-out nav before `useAuth` resolves. (The sidebar otherwise renders on
  // every page and adapts to auth state.)
  if (loading) return null;

  // Highlights only on /profile (redirects to {me}) and /profile/{me.username}.
  // Another analyst's profile is a deep destination, not "your" account.
  const profileActive =
    !!user &&
    (pathname === "/profile" ||
      pathname === `/profile/${user.username}` ||
      pathname === `/profile/${user.username}/detections`);

  // The brand mark is the Home entry now, so it lights like a nav row on `/`.
  const homeActive = pathname === "/";

  // The drawer is 192px wide whatever the rail's own width is, so it shows
  // labels from the frame it opens and keeps them until the slide out ends:
  // `labelsVisible` only paces the desktop width animation, which the drawer
  // does not run, and `drawerLabels` paces the drawer's own. `drawerOpen` is in
  // here too, so an open drawer shows labels even if a control added later
  // forgets the gate; only the slide-out lag would be lost.
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
      {/* Phone only: the rail's chrome while it is off-canvas. A floating chip
          in the top-left corner, 8px in from both edges, holding the open
          control and the page's back control; pages clear it with their own top
          padding (PageShell's `max-sm:pt-16`) rather than surrendering a row to
          a bar. Above the aside's own z, since the drawer comes later in tree
          order and would otherwise paint over it: the chip and the page's back
          control stay visible while the drawer is out. */}
      <div className="sm:hidden fixed top-2 left-2 safe-mt safe-ml z-1150 flex items-center gap-0.5 rounded-md p-0.5 bg-neutral-900 border border-neutral-800">
        {/* Hand-rolled and not `<Button icon>`: this is a 44px neutral thumb
            target, and the primitive offers one 36px square in accent or red
            only. */}
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
        {/* The back control's seat: `PageShell` portals its own button in here
            on a page that carries one, so on a phone the arrow rides the chip
            instead of taking a row of its own above the title. Empty on every
            other page, where the chip is the open control alone. */}
        <div
          id="phone-back-slot"
          className="flex items-center"
          ref={setPhoneBackSlot}
        />
      </div>

      {/* Phone only: tapping beside the open drawer closes it. Its own name,
          not the foot button's: two controls that do the same thing from
          different places, and a reader picking one out of a list has to tell
          the sheet of glass from the row. */}
      {drawerOpen && (
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation overlay"
          // z scale: map panels 1000, this scrim 1090, the rail and drawer
          // 1100, the beta pill 1200, the media lightbox 1500. The scrim sits
          // just under the drawer it dims and over everything else.
          className="sm:hidden fixed inset-0 z-1090 bg-black/50"
        />
      )}

      <aside
        id={NAV_ID}
        aria-label="Primary navigation"
        // Modal only while it is a drawer: the open drawer covers the page
        // behind a scrim, which is what `dialog` + `aria-modal` describe. From
        // `sm` up the same element is a plain landmark beside the page, so it
        // carries neither.
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen ? true : undefined}
        // Any link inside the drawer closes it on the way out. The route-change
        // effect above cannot carry this alone, since a tap on the entry that is
        // already active (About while on /about) changes no pathname and so
        // never runs it: the drawer would stay open over the page it
        // "navigated" to, with the body still scroll-locked. One handler here
        // rather than an `onClick` per link, so a row added later is wired by
        // construction. Closing a closed drawer is a no-op, so the cheap
        // `closest` answers for every width.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setDrawerOpen(false);
        }}
        // `max-sm:invisible` takes the closed drawer out of the tab order; the
        // transition carries `visibility` too, so it flips at the end of the
        // slide out instead of blanking the drawer mid-animation.
        className={`fixed top-0 left-0 h-screen z-1100 flex flex-col safe-pt safe-pb safe-pl bg-neutral-900 border-r border-neutral-800 transition-[width] duration-200 max-sm:h-dvh max-sm:w-48 max-sm:transition-[transform,visibility] ${
          expanded ? "w-48" : "w-14"
        } ${
          drawerOpen
            ? "max-sm:translate-x-0 max-sm:visible"
            : "max-sm:-translate-x-full max-sm:invisible"
        }`}
      >
        {/* Community glyphs ride the right of the row when expanded (no room in
            the 56px collapsed rail). pt-3/pb-1 keep the mark tight against the
            rail, not floating in a tall header. */}
        <div className="flex items-center gap-1 px-2 pt-3 pb-1 overflow-hidden">
          {/* The brand mark doubles as the Home entry: it links `/` and takes
              the same row treatment (hover + active highlight) as the items
              below, now that Home has no separate rail slot. */}
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

        {/* flex-1 pushes the bottom block down, so the gap is visual, not a
            border. The logo header's pb-1 sets the top gap, so no pt here.
            `min-h-0` lets this flex child shrink below its content, and the
            scroll then falls here rather than on the aside: on a 320px-tall
            landscape phone the rows would otherwise push the identity block
            and the foot controls off the bottom edge, out of reach. */}
        <nav
          ref={navRef}
          className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 px-2 pb-3"
        >
          {NAV_ITEMS.filter((item) => !item.auth || user).map(renderNavItem)}
        </nav>

        {/* Bottom block, one visual group, no border-t: the flex-1 spacer above
            separates it. */}
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
              {/* The analyst's own picture, in the same 18px box as every rail
                  glyph, so the identity row reads as "you" instead of a generic
                  user icon. `<Avatar>` owns the circle, the image and the icon
                  fallback; the wrapper exists only to anchor the badge.
                  `text-current` keeps the fallback glyph on the row's own colour,
                  so it still brightens on hover and takes the accent when
                  active, like every glyph above it. `decorative` keeps the
                  picture out of the link's accessible name, which stays the
                  handle (plus the pending count) from `title`. */}
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

          {/* The foot control, one row at every width but two buttons: below
              `sm` it closes the drawer, from `sm` up it folds the rail. They
              act on different state, so a single button would have to read the
              viewport to know which. */}
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

          {/* The corner pill hides on a phone (it would sit over the content),
              so the drawer carries the same build badge and bug-report link. */}
          <BetaBanner inline />
        </div>
      </aside>
    </>
  );
}

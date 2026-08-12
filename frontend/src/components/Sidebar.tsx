"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { useAdmin } from "@/hooks/useAdmin";
import { ACCENT_SURFACE } from "@/components/ui/styles";
import { Dot } from "@/components/ui/Dot";
import {
  DiscordGlyph,
  GitHubGlyph,
  XGlyph,
} from "@/components/ui/BrandGlyphs";
import {
  Globe,
  Plus,
  User,
  Settings,
  Search,
  Info,
  LogIn,
  Megaphone,
  Swords,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const X_URL = "https://x.com/vidithq";
const DISCORD_URL = "https://discord.gg/9wPtsrrKyJ";
const GITHUB_URL = "https://github.com/vidithq/vidit";

// Fixed-height row for every nav item, sign-in/out, and the toggle, so icons
// stay at the same y position whether collapsed or expanded.
const ROW_CLASS =
  "flex items-center gap-2.5 h-9 rounded-md px-2.5 text-sm transition-colors";

// Must match the aside's `duration-200` width transition. Labels render only
// after the expand finishes, else they overflow the still-narrow sidebar mid-
// animation and flicker.
const EXPAND_TRANSITION_MS = 200;

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
      p === "/bot",
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
  const [expanded, setExpanded] = useState(false);
  // Lags `expanded` when growing (labels appear after width animates) and leads
  // it when shrinking, avoiding the mid-animation overflow flicker.
  const [labelsVisible, setLabelsVisible] = useState(false);
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

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item, pathname);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={!labelsVisible ? item.label : undefined}
        className={`${ROW_CLASS} overflow-hidden ${
          active
            ? ACCENT_SURFACE
            : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
        }`}
      >
        <Icon size={18} strokeWidth={active ? 2.2 : 1.8} className="shrink-0" />
        {labelsVisible && (
          <span className="truncate flex-1 animate-label-in">{item.label}</span>
        )}
      </Link>
    );
  };

  return (
    <aside
      aria-label="Primary navigation"
      className={`fixed top-0 left-0 h-screen z-1100 flex flex-col bg-neutral-900 border-r border-neutral-800 transition-[width] duration-200 ${
        expanded ? "w-48" : "w-14"
      }`}
    >
      {/* The brand mark doubles as the Home entry: it links `/` and takes the
          same row treatment (hover + active highlight) as the items below, now
          that Home has no separate rail slot. Community glyphs ride the right of
          the row when expanded (no room in the 56px collapsed rail). pt-3/pb-1
          keep the mark tight against the rail, not floating in a tall header. */}
      <div className="flex items-center gap-1 px-2 pt-3 pb-1 overflow-hidden">
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
        {labelsVisible && (
          <div className="flex items-center gap-1 ml-auto pr-1 animate-label-in">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="Vidit on GitHub"
              aria-label="Vidit on GitHub"
              className="size-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
            >
              <GitHubGlyph />
            </a>
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="Vidit on X"
              aria-label="Vidit on X"
              className="size-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
            >
              <XGlyph />
            </a>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="Vidit Discord"
              aria-label="Vidit Discord"
              className="size-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
            >
              <DiscordGlyph />
            </a>
          </div>
        )}
      </div>

      {/* flex-1 pushes the bottom block down, so the gap is visual, not a
          border. The logo header's pb-1 sets the top gap, so no pt here. */}
      <nav className="flex-1 flex flex-col gap-1 px-2 pb-3">
        {NAV_ITEMS.filter((item) => !item.auth || user).map(renderNavItem)}
      </nav>

      {/* Bottom block — one visual group, no border-t: the flex-1 spacer above
          separates it. */}
      <div className="flex flex-col gap-1 px-2 pb-3">
        {isAdmin && renderNavItem(ADMIN_ITEM)}
        {user ? (
          <Link
            href={`/profile/${user.username}`}
            title={
              !labelsVisible
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
            <span className="relative size-[18px] rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center shrink-0">
              <User size={11} strokeWidth={1.8} />
              {/* Pending-submission nudge, the rail's only badge. */}
              {detectionCount > 0 && (
                <Dot className="absolute -top-0.5 -right-1 ring-2 ring-neutral-900" />
              )}
            </span>
            {labelsVisible && (
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

        {/* Icon tracks `expanded` (flips immediately on click); label tracks
            `labelsVisible` so it doesn't flicker mid-animation. */}
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={expanded}
          title={!labelsVisible ? "Expand sidebar" : undefined}
          className={`${ROW_CLASS} w-full overflow-hidden text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800`}
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
      </div>
    </aside>
  );
}

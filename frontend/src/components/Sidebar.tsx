"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/useAdmin";
import { FILTER_CHIP_ACTIVE } from "@/components/ui/styles";
import {
  Globe,
  Home,
  Plus,
  User,
  Settings,
  Newspaper,
  Search,
  Info,
  LogIn,
  Target,
  Swords,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import WipBadge from "@/components/ui/WipBadge";
import TrustBadge from "@/components/profile/TrustBadge";

const X_URL = "https://x.com/vidithq";
const DISCORD_URL = "https://discord.gg/9wPtsrrKyJ";

function XGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function DiscordGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

// Fixed-height row used by every nav item, sign-in/out, and the toggle.
// Keeps icons at the same y position whether the sidebar is collapsed or
// expanded — text appearing/disappearing must not change the row height.
const ROW_CLASS =
  "flex items-center gap-2.5 h-9 rounded-md px-2.5 text-sm transition-colors";

// Must match the `duration-200` on the aside's width transition. Labels
// render only once the expand animation has finished, otherwise they
// overflow the still-narrow sidebar mid-animation and create a flicker
// (especially noticeable next to the "Soon" pills).
const EXPAND_TRANSITION_MS = 200;

interface NavItem {
  href: string;
  icon: typeof Globe;
  label: string;
  auth?: boolean;
  // `wip` shows a "Soon" pill in expanded mode (signals planned-but-not-built).
  // `notify` shows a small dot at the icon corner in both modes (signals new
  // content awaits — today static; later it'll bind to actual unread state).
  // Independent on purpose: Timeline is both (it's a feed AND not built yet);
  // a "search-only" placeholder before the real endpoint shipped would have
  // had `wip` without `notify` — no feed, so no notification semantic.
  wip?: boolean;
  notify?: boolean;
  // Optional custom matcher for the active state — lets deep pages inherit
  // their conceptual section's highlight (e.g. /geolocations/[id] keeps Map
  // highlighted). Defaults to exact match on `href`.
  activeFor?: (pathname: string) => boolean;
}

// Single primary nav. Home (the landing) and About are public — visible to
// everyone; the rest carry `auth: true` and are filtered out when logged
// out (see the render below) so a signed-out visitor only sees nav items
// they can actually use. Profile/Settings/Sign-in/Sign-out are NOT nav
// items: they're rendered as a separate identity-and-control block at the
// bottom.
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/", icon: Home, label: "Home" },
  {
    href: "/map",
    icon: Globe,
    label: "Map",
    auth: true,
    // Event detail pages live conceptually on the map. Match exactly
    // /geolocations/<id> (one path segment, no trailing slash) so future
    // sub-routes like /geolocations/list or /geolocations/<id>/edit don't
    // silently inherit the Map highlight. ``/new`` is a sibling nav item
    // (Submit) that exact-matches the same shape, so it must be excluded
    // here too — otherwise both rows highlight on the submission screen.
    activeFor: (p) =>
      p === "/map" ||
      (/^\/geolocations\/[^/]+$/.test(p) && p !== "/geolocations/new"),
  },
  { href: "/timeline", icon: Newspaper, label: "Timeline", auth: true },
  { href: "/search", icon: Search, label: "Search", auth: true },
  {
    href: "/bounties",
    icon: Target,
    label: "Bounties",
    auth: true,
    // Bounty detail and creation pages belong conceptually to Bounties.
    // Unlike Map (which has to exclude /geolocations/new because Submit
    // lives there), Submit owns /geolocations/new — not /bounties/new —
    // so no exclusion is needed here.
    activeFor: (p) => p === "/bounties" || p.startsWith("/bounties/"),
  },
  { href: "/geolocations/new", icon: Plus, label: "Submit", auth: true },
  { href: "/about", icon: Info, label: "About" },
];

function isActive(item: NavItem, pathname: string): boolean {
  return item.activeFor ? item.activeFor(pathname) : pathname === item.href;
}

export default function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  // Lags behind `expanded` when growing (so labels appear *after* the width
  // has finished animating) and leads it when shrinking (so labels disappear
  // *before* width starts collapsing). Avoids the mid-animation overflow
  // flicker on the "Soon" pills.
  const [labelsVisible, setLabelsVisible] = useState(false);
  const pathname = usePathname() ?? "";
  const { user, loading } = useAuth();
  const { isAdmin } = useAdmin();

  useEffect(() => {
    if (expanded) {
      const t = setTimeout(() => setLabelsVisible(true), EXPAND_TRANSITION_MS);
      return () => clearTimeout(t);
    }
    // Collapsing: hide labels in the same render that starts the width
    // transition, so they're gone before the bar visually narrows.
    setLabelsVisible(false);
  }, [expanded]);

  // Sidebar is the one persistent chrome — it renders on every page
  // (the landing, public pages, the app, and the auth screens) so
  // navigation is consistent and a logged-out visitor never dead-ends.
  // It adapts to auth state: `auth`-flagged nav items are filtered out
  // when signed out (see the nav render below), and the bottom identity
  // block swaps to a Sign-in row when there's no user. Only suppressed
  // during the initial auth load to avoid flashing the signed-out nav
  // before `useAuth` resolves.
  if (loading) return null;

  // The user block highlights only on /profile (which redirects to {me}) and
  // on /profile/{me.username}. Visiting another analyst's profile leaves the
  // block unhighlighted — that's a deep destination reached via Search or a
  // link, not "your" account.
  const profileActive =
    !!user &&
    (pathname === "/profile" || pathname === `/profile/${user.username}`);

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item, pathname);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={
          !labelsVisible
            ? `${item.label}${item.wip ? " (coming soon)" : ""}`
            : undefined
        }
        className={`${ROW_CLASS} relative overflow-hidden ${
          active
            ? FILTER_CHIP_ACTIVE
            : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
        }`}
      >
        <span className="relative shrink-0">
          <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
          {item.notify && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-1 size-1.5 rounded-full bg-orange-500 ring-2 ring-neutral-900"
            />
          )}
        </span>
        {labelsVisible && (
          <span className="truncate flex-1 animate-label-in">{item.label}</span>
        )}
        {labelsVisible && item.wip && (
          <span className="animate-label-in">
            <WipBadge>Soon</WipBadge>
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside
      aria-label="Primary navigation"
      className={`fixed top-0 left-0 h-screen z-[1100] flex flex-col bg-neutral-900 border-r border-neutral-800 transition-[width] duration-200 ${
        expanded ? "w-48" : "w-14"
      }`}
    >
      {/* Logo + community shortcuts. Logo paddings mirror the nav rows below
          so the V sits in the same x column as every nav icon (8px nav + 10px
          row = 18px), centered inside an 18px-wide slot like the icons. The
          X and Discord glyphs only render when expanded — there's no room
          for them in the 56px collapsed bar. */}
      <div className="flex items-center h-14 px-2 border-b border-neutral-800 overflow-hidden">
        <Link
          href="/"
          className="flex items-center gap-2.5 px-2.5 min-w-0"
        >
          <span className="w-[18px] flex items-center justify-center shrink-0 text-orange-500 font-bold text-lg leading-none">
            V
          </span>
          {labelsVisible && (
            <span className="text-neutral-100 font-semibold text-sm tracking-tight truncate animate-label-in">
              Vidit
            </span>
          )}
        </Link>
        {labelsVisible && (
          <div className="flex items-center gap-1 ml-auto pr-1 animate-label-in">
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

      {/* Primary nav — site features. flex-1 pushes the bottom block down,
          so the gap between the two is visual (not a border). */}
      <nav className="flex-1 flex flex-col gap-1 px-2 py-3">
        {NAV_ITEMS.filter((item) => !item.auth || user).map(renderNavItem)}
      </nav>

      {/* Bottom block: identity (user block or Sign-in) + Settings + Collapse.
          One visual group, no border-t — just the flex-1 spacer above. */}
      <div className="flex flex-col gap-1 px-2 pb-3">
        {isAdmin && (
          <Link
            href="/admin"
            title={!labelsVisible ? "Admin" : undefined}
            className={`${ROW_CLASS} overflow-hidden ${
              pathname === "/admin"
                ? FILTER_CHIP_ACTIVE
                : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
            }`}
          >
            <Swords size={18} strokeWidth={1.8} className="shrink-0" />
            {labelsVisible && (
              <span className="truncate flex-1 animate-label-in">Admin</span>
            )}
          </Link>
        )}
        {user ? (
          <Link
            href={`/profile/${user.username}`}
            title={!labelsVisible ? user.username : undefined}
            className={`${ROW_CLASS} overflow-hidden ${
              profileActive
                ? FILTER_CHIP_ACTIVE
                : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
            }`}
          >
            <span className="size-[18px] rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center shrink-0">
              <User size={11} strokeWidth={1.8} />
            </span>
            {labelsVisible && (
              <span className="truncate flex-1 inline-flex items-center gap-1 animate-label-in">
                {user.username}
                <TrustBadge
                  isTrusted={user.is_trusted}
                  trustReason={user.trust_reason}
                  size={12}
                />
              </span>
            )}
          </Link>
        ) : (
          <Link
            href="/login"
            title={!labelsVisible ? "Sign in" : undefined}
            className={`${ROW_CLASS} overflow-hidden text-neutral-400 hover:text-orange-400 hover:bg-neutral-800`}
          >
            <LogIn size={18} strokeWidth={1.8} className="shrink-0" />
            {labelsVisible && (
              <span className="truncate animate-label-in">Sign in</span>
            )}
          </Link>
        )}

        {user && (
          <Link
            href="/settings"
            title={!labelsVisible ? "Settings" : undefined}
            className={`${ROW_CLASS} overflow-hidden ${
              pathname === "/settings"
                ? FILTER_CHIP_ACTIVE
                : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
            }`}
          >
            <Settings size={18} strokeWidth={1.8} className="shrink-0" />
            {labelsVisible && (
              <span className="truncate flex-1 animate-label-in">Settings</span>
            )}
          </Link>
        )}

        {/* Toggle expand — sidebar control, lives at the very bottom. Icon
            tracks `expanded` (intent) so it flips immediately on click;
            label tracks `labelsVisible` so it doesn't flicker mid-animation. */}
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

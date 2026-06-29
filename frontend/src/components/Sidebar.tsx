"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useDetectionsCount } from "@/contexts/DetectionsContext";
import { useAdmin } from "@/hooks/useAdmin";
import { FILTER_CHIP_ACTIVE } from "@/components/ui/styles";
import {
  Globe,
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
import TrustBadge from "@/components/profile/TrustBadge";

const X_URL = "https://x.com/vidithq";
const DISCORD_URL = "https://discord.gg/9wPtsrrKyJ";
const GITHUB_URL = "https://github.com/vidithq/vidit";

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

function GitHubGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.28-1.67-1.28-1.67-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.05 11.05 0 0 1 5.8 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.73.81 1.18 1.83 1.18 3.09 0 4.43-2.69 5.41-5.26 5.69.41.36.78 1.07.78 2.16 0 1.56-.01 2.81-.01 3.19 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
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
  // `notify` shows a dot at the icon corner (new content awaits; static today).
  notify?: boolean;
  // Custom active-state matcher so deep pages inherit their section's highlight
  // (e.g. /geolocations/[id] keeps Map lit). Defaults to exact match on `href`.
  activeFor?: (pathname: string) => boolean;
}

// Map (the catalogue), Submit (add your work), Bounties (the board) are the
// working surfaces; Timeline + Search are alternate lenses on the catalogue.
// About (public/meta) sits last. Home has no rail slot: the logo already links
// it, so a second entry was pure noise once signed in. Logged out, the rail
// filters down to just About (the rest carry `auth: true`).
// Profile/Settings/Sign-in/Sign-out are a separate identity block at the bottom,
// not here.
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  {
    href: "/map",
    icon: Globe,
    label: "Map",
    auth: true,
    // Match exactly /geolocations/<id> (one segment) so a geolocation detail
    // keeps the Map highlight; sub-routes like /geolocations/<id>/edit don't.
    // Submit lives at /submit now, so no carve-out is needed here.
    activeFor: (p) => p === "/map" || /^\/geolocations\/[^/]+$/.test(p),
  },
  { href: "/submit", icon: Plus, label: "Submit", auth: true },
  {
    href: "/bounties",
    icon: Target,
    label: "Bounties",
    auth: true,
    // Every /bounties/* path is a Bounties page (creation lives at /submit).
    activeFor: (p) => p === "/bounties" || p.startsWith("/bounties/"),
  },
  { href: "/timeline", icon: Newspaper, label: "Timeline", auth: true },
  { href: "/search", icon: Search, label: "Search", auth: true },
  { href: "/about", icon: Info, label: "About" },
];

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

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item, pathname);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={!labelsVisible ? item.label : undefined}
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
      {/* Logo + community shortcuts. Paddings mirror the nav rows so the V sits
          in the same x column as every nav icon. The glyphs render only when
          expanded — no room in the 56px collapsed bar. */}
      <div className="flex items-center h-14 px-2 overflow-hidden">
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
          border. */}
      <nav className="flex-1 flex flex-col gap-1 px-2 py-3">
        {NAV_ITEMS.filter((item) => !item.auth || user).map(renderNavItem)}
      </nav>

      {/* Bottom block — one visual group, no border-t: the flex-1 spacer above
          separates it. */}
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
            title={
              !labelsVisible
                ? detectionCount > 0
                  ? `${user.username} · ${detectionCount} to submit`
                  : user.username
                : undefined
            }
            className={`${ROW_CLASS} overflow-hidden ${
              profileActive
                ? FILTER_CHIP_ACTIVE
                : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
            }`}
          >
            <span className="relative size-[18px] rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center shrink-0">
              <User size={11} strokeWidth={1.8} />
              {/* Pending-submission nudge, same dot the nav items use. */}
              {detectionCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-1 size-1.5 rounded-full bg-orange-500 ring-2 ring-neutral-900"
                />
              )}
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
            {detectionCount > 0 && (
              <span className="sr-only">
                {detectionCount} geolocations awaiting submission
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

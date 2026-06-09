"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import GeolocationCard from "@/components/geolocation/GeolocationCard";
import {
  User as UserIcon,
  MapPin,
  Calendar,
  Users,
  UserPlus,
  AtSign,
  MessageCircle,
  Globe,
  Code,
  ExternalLink,
  LogOut,
  Pencil,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { formatDate } from "@/lib/format";
import { resolveLinkHref, updateMyProfile, type PublicProfile } from "@/lib/users";
import type { ExternalLinks } from "@/types";
import TrustBadge from "@/components/profile/TrustBadge";
import FollowButton from "@/components/profile/FollowButton";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { PRIMARY_BUTTON, TAPPABLE_HOVER } from "@/components/ui/styles";
import {
  FORM_INPUT_COMPACT,
  FORM_LABEL,
} from "@/components/ui/form-styles";


const BIO_MAX_LEN = 500;

const LINK_PLATFORMS: {
  key: keyof ExternalLinks;
  label: string;
  Icon: typeof AtSign;
  hint: string;
}[] = [
  { key: "x", label: "X / Twitter", Icon: AtSign, hint: "@handle or https://x.com/handle" },
  { key: "discord", label: "Discord", Icon: MessageCircle, hint: "username" },
  { key: "website", label: "Website", Icon: Globe, hint: "https://your-site.com" },
  { key: "github", label: "GitHub", Icon: Code, hint: "@handle or https://github.com/handle" },
];

interface RecentSubmission {
  id: string;
  title: string;
  event_date: string;
  is_demo: boolean;
  lat: number;
  lng: number;
  tags: { id: string; name: string; category: "conflict" | "free" }[];
}

interface PaginatedSubmissions {
  items: RecentSubmission[];
  total: number;
  page: number;
  per_page: number;
}

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { user: currentUser, loading: authLoading, logout, refresh } = useAuth();

  const username = typeof params.username === "string" ? params.username : "";
  const {
    data: profile,
    error,
    refetch: refetchProfile,
  } = useApiResource<PublicProfile>(
    username && currentUser ? `/users/${username}` : null
  );
  // Error deliberately unread — a failed side list renders as empty
  // rather than blocking the profile card.
  const { data: submissionsData } = useApiResource<PaginatedSubmissions>(
    username && currentUser
      ? `/users/${username}/geolocations?per_page=5`
      : null
  );
  const submissions = submissionsData?.items ?? [];
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Inline-edit state — only relevant on own profile. Drafts are seeded
  // from the live profile when entering edit mode and discarded on
  // cancel; saving PATCHes /users/me and re-fetches to keep view-mode
  // in sync without trusting the local drafts as canonical.
  const [editing, setEditing] = useState(false);
  const [draftBio, setDraftBio] = useState("");
  const [draftAvatarUrl, setDraftAvatarUrl] = useState("");
  const [draftLinks, setDraftLinks] = useState<ExternalLinks>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Auto-revert the sign-out confirm state if not followed through within 3s.
  useEffect(() => {
    if (!confirmingSignOut) return;
    const t = setTimeout(() => setConfirmingSignOut(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingSignOut]);

  const handleSignOut = () => {
    if (confirmingSignOut) {
      setSigningOut(true);
      setConfirmingSignOut(false);
      logout();
    } else {
      setConfirmingSignOut(true);
    }
  };

  // Auth guard
  useEffect(() => {
    if (signingOut) return;
    if (!authLoading && !currentUser) {
      router.push("/login");
    }
  }, [authLoading, currentUser, router, signingOut]);

  // Drop edit mode whenever the visible profile switches usernames —
  // editing is always "this user, right now"; navigating away without
  // saving should not silently leak drafts into another profile.
  useEffect(() => {
    setEditing(false);
    setSaveError(null);
  }, [username]);

  if (authLoading || !currentUser) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading...</span>
      </PageCenter>
    );
  }

  if (error) {
    return (
      <PageCenter>
        <div className="text-center space-y-2">
          <p className="text-sm text-neutral-300">{error}</p>
          <Link href="/map" className="text-xs text-orange-400 hover:underline">
            Back to map
          </Link>
        </div>
      </PageCenter>
    );
  }

  if (!profile) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading...</span>
      </PageCenter>
    );
  }

  const isOwn = profile.username === currentUser.username;
  const presentLinks = LINK_PLATFORMS.filter(
    (p) => Boolean(profile.external_links[p.key])
  );

  // Avatar shown is the draft preview in edit mode, the persisted URL
  // otherwise. Falls back to the icon if neither resolves.
  const displayedAvatar = editing ? draftAvatarUrl : profile.avatar_url;

  const startEditing = () => {
    setDraftBio(profile.bio ?? "");
    setDraftAvatarUrl(profile.avatar_url ?? "");
    setDraftLinks(profile.external_links ?? {});
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveError(null);
  };

  const saveEdits = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Backend treats `external_links` as wholesale-replace. Sending each
      // platform explicitly (with null for empty) drops cleared platforms
      // instead of leaving stale values in the JSONB.
      await updateMyProfile({
        bio: draftBio,
        avatar_url: draftAvatarUrl,
        external_links: {
          x: draftLinks.x ?? null,
          discord: draftLinks.discord ?? null,
          website: draftLinks.website ?? null,
          github: draftLinks.github ?? null,
        },
      });
      // Refresh AuthContext so the sidebar / other surfaces pick up the
      // new avatar + bio without a hard reload.
      await refresh();
      refetchProfile();
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const bioRemaining = BIO_MAX_LEN - draftBio.length;
  const bioOver = bioRemaining < 0;

  return (
    <PageShell back title="Profile">
        {/* Identity card: avatar + (username + trust + email) + action.
            Page title above stays generic; the user-specific identity
            lives here so the layout works for own profile and others'
            with the same chrome. */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-16 h-16 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center overflow-hidden shrink-0">
              {displayedAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayedAvatar}
                  alt={`${profile.username}'s avatar`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserIcon size={28} className="text-neutral-500" />
              )}
            </div>
            <div className="min-w-0">
              {/* Username is the semantically most important content on the
                  page — render it as an h2 under PageShell's generic
                  "Profile" h1 so screen readers and the document outline
                  expose it. Visual style stays the same. */}
              <h2 className="text-base font-medium text-neutral-100 inline-flex items-center gap-2">
                {profile.username}
                <TrustBadge
                  isTrusted={profile.is_trusted}
                  trustReason={profile.trust_reason}
                  size={14}
                />
              </h2>
              {isOwn && (
                <p className="text-sm text-neutral-400 mt-0.5 truncate">
                  {currentUser.email}
                </p>
              )}
            </div>
          </div>
          <div className="shrink-0">
            {isOwn ? (
              editing ? (
                <div className="inline-flex gap-2">
                  <button
                    type="button"
                    onClick={cancelEditing}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-md text-xs text-neutral-300 hover:text-neutral-100 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveEdits}
                    disabled={saving || bioOver}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 ${PRIMARY_BUTTON}`}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startEditing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-orange-400 hover:bg-orange-500/10 border border-orange-500/30 transition-colors"
                >
                  <Pencil size={12} />
                  Edit profile
                </button>
              )
            ) : (
              <FollowButton
                username={profile.username}
                initialFollowing={profile.is_following}
              />
            )}
          </div>
        </div>

        {/* Avatar URL input — only when editing. Sits below the avatar
            row so the input it edits is visually adjacent. */}
        {editing && (
          <div className="max-w-sm">
            <label className={FORM_LABEL} htmlFor="avatar-url">
              Avatar URL
            </label>
            <input
              id="avatar-url"
              type="url"
              inputMode="url"
              placeholder="https://example.com/me.jpg"
              value={draftAvatarUrl}
              onChange={(e) => setDraftAvatarUrl(e.target.value)}
              className={`mt-1 ${FORM_INPUT_COMPACT}`}
            />
          </div>
        )}

        {saveError && (
          <div className="px-3 py-2 rounded-md text-xs text-red-300 bg-red-500/10 border border-red-500/30">
            {saveError}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
            <div className="flex items-center gap-1.5 text-neutral-500 mb-1">
              <MapPin size={11} />
              <span className="text-[10px] uppercase tracking-wider">Submitted</span>
            </div>
            <span className="text-lg font-medium text-neutral-100">
              {profile.geolocations_count}
            </span>
          </div>
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
            <div className="flex items-center gap-1.5 text-neutral-500 mb-1">
              <Users size={11} />
              <span className="text-[10px] uppercase tracking-wider">Followers</span>
            </div>
            <span className="text-lg font-medium text-neutral-100">{profile.followers_count}</span>
          </div>
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
            <div className="flex items-center gap-1.5 text-neutral-500 mb-1">
              <UserPlus size={11} />
              <span className="text-[10px] uppercase tracking-wider">Following</span>
            </div>
            <span className="text-lg font-medium text-neutral-100">{profile.following_count}</span>
          </div>
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-3">
            <div className="flex items-center gap-1.5 text-neutral-500 mb-1">
              <Calendar size={11} />
              <span className="text-[10px] uppercase tracking-wider">Since</span>
            </div>
            <span className="text-sm font-medium text-neutral-100">
              {formatDate(profile.created_at)}
            </span>
          </div>
        </div>

        {/* Bio */}
        {editing ? (
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-neutral-300">Bio</h2>
              <span
                className={`text-[11px] ${
                  bioOver ? "text-red-400" : "text-neutral-500"
                }`}
              >
                {bioRemaining} / {BIO_MAX_LEN}
              </span>
            </div>
            <textarea
              value={draftBio}
              onChange={(e) => setDraftBio(e.target.value)}
              placeholder="A short blurb about you, your focus area, what to expect from your submissions."
              className={`${FORM_INPUT_COMPACT} min-h-[96px] resize-y`}
            />
          </div>
        ) : profile.bio ? (
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-2">
            <h2 className="text-sm font-medium text-neutral-300">Bio</h2>
            <p className="text-sm text-neutral-200 whitespace-pre-line">
              {profile.bio}
            </p>
          </div>
        ) : null}

        {/* Linked accounts */}
        {editing ? (
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-3">
            <h2 className="text-sm font-medium text-neutral-300">
              Linked accounts
            </h2>
            <div className="space-y-2">
              {LINK_PLATFORMS.map((p) => {
                const Icon = p.Icon;
                return (
                  <div
                    key={p.key}
                    className="flex items-center gap-2 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md"
                  >
                    <Icon size={14} className="text-neutral-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={`link-${p.key}`}
                        className="text-[10px] uppercase tracking-wider text-neutral-500"
                      >
                        {p.label}
                      </label>
                      <input
                        id={`link-${p.key}`}
                        type="text"
                        placeholder={p.hint}
                        value={draftLinks[p.key] ?? ""}
                        onChange={(e) =>
                          setDraftLinks((prev) => ({
                            ...prev,
                            [p.key]: e.target.value,
                          }))
                        }
                        className="block w-full bg-transparent text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-hidden"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : presentLinks.length > 0 ? (
          <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-3">
            <h2 className="text-sm font-medium text-neutral-300">
              Linked accounts
            </h2>
            <div className="space-y-2">
              {presentLinks.map((p) => {
                const value = profile.external_links[p.key] ?? "";
                const href = resolveLinkHref(p.key, value);
                // Orange-value rule: clickable rows (where the string
                // sniffs as an http URL) read as clickable; plain handles
                // (e.g. a Discord username) keep neutral text. Stays
                // consistent with the "if it's orange, it's clickable"
                // design rule.
                const valueClass = href
                  ? "text-sm text-orange-400 truncate"
                  : "text-sm text-neutral-200 truncate";
                const inner = (
                  <>
                    <p.Icon size={14} className="text-neutral-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className={FORM_LABEL}>{p.label}</span>
                      <p className={valueClass}>{value}</p>
                    </div>
                    {href && (
                      <ExternalLink size={12} className="text-orange-400/70 shrink-0" />
                    )}
                  </>
                );
                return href ? (
                  <a
                    key={p.key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-3 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md ${TAPPABLE_HOVER}`}
                  >
                    {inner}
                  </a>
                ) : (
                  <div
                    key={p.key}
                    className="flex items-center gap-3 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md"
                  >
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Recent submissions */}
        <div className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-neutral-300">
              Recent submissions
            </h2>
            <p className="text-xs text-neutral-500">
              {profile.geolocations_count > 0
                ? `${profile.username}'s latest geolocations, newest first.`
                : "No geolocations yet."}
            </p>
          </div>

          {submissions.length > 0 ? (
            <div className="space-y-2">
              {submissions.map((entry) => (
                <GeolocationCard
                  key={entry.id}
                  geo={entry}
                  variant="compact"
                  hideAuthor
                  mediaSeed={`sub-${entry.id}`}
                />
              ))}
            </div>
          ) : isOwn ? (
            // First-impression surface for the freshly-invited analyst:
            // own profile with nothing submitted yet. The standalone
            // "Submit your first geolocation →" link gives the page a
            // clear next action instead of dead-ending on an italic
            // sentence. Visually centered + a touch of vertical air so
            // the CTA actually reads as a thing to do, not a caption.
            <div className="py-4 text-center space-y-3">
              <p className="text-sm text-neutral-400">
                No geolocations submitted yet.
              </p>
              <Link
                href="/geolocations/new"
                className="inline-block text-xs text-orange-400 hover:underline"
              >
                Submit your first geolocation →
              </Link>
            </div>
          ) : (
            <p className="text-xs text-neutral-500 italic">Nothing yet.</p>
          )}
        </div>

        {isOwn && (
          <>
            {/* Sign out — only on your own profile. Two-click confirm so an
                accidental tap doesn't end the session; auto-reverts after 3s. */}
            <div className="pt-4 border-t border-neutral-800 flex justify-center">
              <button
                type="button"
                onClick={handleSignOut}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  confirmingSignOut
                    ? "bg-red-500/15 text-red-400 border border-red-500/30"
                    : "text-orange-400 hover:bg-orange-500/10 border border-orange-500/30"
                }`}
              >
                <LogOut size={14} strokeWidth={1.8} />
                {confirmingSignOut ? "Confirm sign out" : "Sign out"}
              </button>
            </div>
          </>
        )}
    </PageShell>
  );
}

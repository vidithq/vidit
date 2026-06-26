"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import type { PublicProfile } from "@/lib/users";
import { BioCard } from "@/components/profile/BioCard";
import { LinkedAccountsCard } from "@/components/profile/LinkedAccountsCard";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileStats } from "@/components/profile/ProfileStats";
import {
  RecentSubmissions,
  type PaginatedSubmissions,
} from "@/components/profile/RecentSubmissions";
import { ReviewQueueEntry } from "@/components/profile/ReviewQueueEntry";
import { useProfileEdit } from "@/components/profile/useProfileEdit";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { useReviewQueue } from "@/contexts/ReviewQueueContext";

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
  // Error deliberately unread: a failed submissions list renders empty
  // rather than blocking the profile card.
  const { data: submissionsData } = useApiResource<PaginatedSubmissions>(
    username && currentUser
      ? `/users/${username}/geolocations?per_page=5`
      : null
  );
  const submissions = submissionsData?.items ?? [];
  // Shared with the sidebar dot via the provider — owner-scoped server-side, so
  // it's the signed-in user's pending count regardless of whose profile this is
  // (gated to the own-profile render below).
  const { count: reviewCount } = useReviewQueue();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const edit = useProfileEdit({
    username,
    profile,
    refreshAuth: refresh,
    refetchProfile,
  });

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

  return (
    <PageShell back title="Profile">
        <ProfileHeader
          profile={profile}
          isOwn={isOwn}
          email={currentUser.email}
          edit={edit}
        />

        <ProfileStats profile={profile} />

        <BioCard profile={profile} edit={edit} />

        <LinkedAccountsCard profile={profile} edit={edit} />

        {isOwn && reviewCount > 0 && (
          <ReviewQueueEntry username={profile.username} count={reviewCount} />
        )}

        <RecentSubmissions
          profile={profile}
          submissions={submissions}
          isOwn={isOwn}
        />

        {isOwn && (
          <>
            {/* Two-click confirm so an accidental tap doesn't end the
                session; auto-reverts after 3s. */}
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

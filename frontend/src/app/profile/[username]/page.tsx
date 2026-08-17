"use client";

import { useParams } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import type { PublicProfile } from "@/lib/users";
import { Button } from "@/components/ui/Button";
import { BioCard } from "@/components/profile/BioCard";
import { LinkedAccountsCard } from "@/components/profile/LinkedAccountsCard";
import {
  ProfileActions,
  ProfileHeaderEditFields,
  ProfileTitle,
} from "@/components/profile/ProfileHeader";
import { ProfileInsights } from "@/components/profile/ProfileInsights";
import { ProfileMap } from "@/components/profile/ProfileMap";
import { ProfileStats } from "@/components/profile/ProfileStats";
import {
  RecentSubmissions,
  type PaginatedSubmissions,
} from "@/components/profile/RecentSubmissions";
import { DetectionsEntry } from "@/components/profile/DetectionsEntry";
import { useProfileEdit } from "@/components/profile/useProfileEdit";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { useDetectionsCount } from "@/contexts/DetectionsContext";

export default function ProfilePage() {
  const params = useParams();
  const { user: currentUser, loading: authLoading, logout, refresh } = useAuth();

  // Public read surface: the profile and its submissions load without a
  // session (`GET /users/{username}` is anonymous); only the owner
  // affordances below gate on `currentUser`.
  const username = typeof params.username === "string" ? params.username : "";
  const {
    data: profile,
    error,
    refetch: refetchProfile,
  } = useApiResource<PublicProfile>(username ? `/users/${username}` : null);
  // Error deliberately unread: a failed submissions list renders empty
  // rather than blocking the profile card.
  const { data: submissionsData } = useApiResource<PaginatedSubmissions>(
    username ? `/users/${username}/events?per_page=5` : null
  );
  const submissions = submissionsData?.items ?? [];
  // Shared with the sidebar dot via the provider — owner-scoped server-side, so
  // it's the signed-in user's pending count regardless of whose profile this is
  // (gated to the own-profile render below).
  const { count: detectionCount } = useDetectionsCount();

  const edit = useProfileEdit({
    username,
    profile,
    refreshAuth: refresh,
    refetchProfile,
  });

  // Two-click confirm so an accidental tap doesn't end the session;
  // auto-reverts after 3s. Signing out just re-renders this page in its
  // anonymous shape (the profile is public); no redirect needed.
  const signOut = useConfirmAction(
    () => {
      logout();
    },
    { timeoutMs: 3000 }
  );

  // Wait for auth to resolve before rendering, so the owner affordances
  // (edit, sign-out) don't pop in after an anonymous-looking first paint.
  if (authLoading) {
    return <PageLoading />;
  }

  if (error) {
    return <PageError message={error} backHref="/map" />;
  }

  if (!profile) {
    return <PageLoading />;
  }

  const isOwn = !!currentUser && profile.username === currentUser.username;

  // Portfolio order: who, then the work, then the account. The handle titles
  // the page, the bio positions it, the linked accounts carry the rest of that
  // identity (they are where the analyst already posts, so they belong beside
  // the bio rather than at the far end of the page), and everything below is
  // evidence, shape of work first (`ProfileInsights`), then where it happened
  // (`ProfileMap`), then the events themselves. Sign out sinks under all of
  // it, so a visitor lands on a portfolio and the owner still finds their
  // controls in one place.
  //
  // The detections entry is the exception: it is pending work, not an account
  // control, so on the owner's own profile it opens the page, above the bio.
  // A queue of hundreds read as buried at the bottom of the portfolio.
  //
  // Editing collapses that order to the form alone: every editable field sits
  // between the header and Save, with the read-only portfolio sections dropped
  // for the duration. The bio and the linked-accounts inputs are contiguous in
  // both modes, which is what keeps Save on screen by the time you reach them.
  return (
    <PageShell
      back
      title={<ProfileTitle profile={profile} edit={edit} />}
      subtitle={isOwn ? currentUser?.email : undefined}
      actions={<ProfileActions profile={profile} isOwn={isOwn} edit={edit} />}
    >
      <ProfileHeaderEditFields profile={profile} edit={edit} />

      {!edit.editing && isOwn && detectionCount > 0 && (
        <DetectionsEntry username={profile.username} count={detectionCount} />
      )}

      <BioCard profile={profile} edit={edit} />

      <LinkedAccountsCard profile={profile} edit={edit} />

      {!edit.editing && (
        <>
          <ProfileStats profile={profile} />

          <ProfileInsights username={profile.username} />

          <ProfileMap username={profile.username} />

          <RecentSubmissions
            profile={profile}
            submissions={submissions}
            isOwn={isOwn}
          />

          {isOwn && (
            <div className="pt-4 border-t border-neutral-800 flex justify-center">
              <Button
                variant={signOut.armed ? "danger" : "secondary"}
                onClick={signOut.trigger}
              >
                <LogOut size={14} strokeWidth={1.8} />
                {signOut.armed ? "Confirm sign out" : "Sign out"}
              </Button>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

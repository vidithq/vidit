"use client";

import { useParams } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import type { PublicProfile } from "@/lib/users";
import { Button } from "@/components/ui/Button";
import { BioField } from "@/components/profile/BioField";
import { LinkedAccountsCard } from "@/components/profile/LinkedAccountsCard";
import {
  ProfileActions,
  ProfileHeaderEditFields,
  ProfileIdentity,
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

  // Portfolio order: show the work, then explain the work, then say where to
  // reach the person. Most probative first, most incidental last.
  //
  // The identity is one compact block and not a section: the handle titles the
  // page, the avatar sits beside it, and the bio is the line under it
  // (`ProfileIdentity`), so a visitor is one scroll-free glance from evidence.
  // Then the counters, then the coverage map, then the submissions themselves:
  // three readings of the same body of work, widest first. Insights follows,
  // because a shape-of-work card explains submissions a reader has already
  // seen. Linked accounts land last of the public blocks: they are where to
  // find the analyst elsewhere, which is worth nothing until the work has
  // earned the click. Sign out sinks under all of it.
  //
  // The detections entry is the exception to "work first": it is pending work
  // rather than an account control, so on the owner's own profile it stays
  // above the fold. A queue of hundreds read as buried at the bottom.
  //
  // Editing collapses that order to the form alone: every editable field sits
  // between the header and Save, with the read-only portfolio sections dropped
  // for the duration. The bio and the linked-accounts inputs stay contiguous,
  // which is what keeps Save on screen by the time you reach them, and they
  // stay in the order the page reads them.
  const bio = edit.editing ? null : profile.bio?.trim() || null;
  const ownerEmail = isOwn ? currentUser?.email : undefined;
  return (
    <PageShell
      back
      title={<ProfileTitle profile={profile} edit={edit} />}
      // No slot at all when the analyst wrote no bio and the viewer is not the
      // owner, so the handle stands alone instead of over an empty line.
      subtitle={
        bio || ownerEmail ? <ProfileIdentity bio={bio} email={ownerEmail} /> : undefined
      }
      actions={<ProfileActions profile={profile} isOwn={isOwn} edit={edit} />}
    >
      <ProfileHeaderEditFields edit={edit} />

      {!edit.editing && isOwn && detectionCount > 0 && (
        <DetectionsEntry username={profile.username} count={detectionCount} />
      )}

      <BioField edit={edit} />

      {!edit.editing && (
        <>
          <ProfileStats profile={profile} />

          <ProfileMap username={profile.username} />

          <RecentSubmissions
            profile={profile}
            submissions={submissions}
            isOwn={isOwn}
          />

          <ProfileInsights username={profile.username} />
        </>
      )}

      <LinkedAccountsCard profile={profile} edit={edit} />

      {!edit.editing && isOwn && (
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
    </PageShell>
  );
}

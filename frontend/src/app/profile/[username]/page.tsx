"use client";

import { useParams } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { eventListPath } from "@/lib/events";
import type { PublicProfile } from "@/lib/users";
import type { EventListItem } from "@/types";
import { Button } from "@/components/ui/Button";
import { CollectionsSection } from "@/components/collections/CollectionsSection";
import { BioField } from "@/components/profile/BioField";
import { LinkedAccountsFields } from "@/components/profile/LinkedAccounts";
import {
  ProfileActions,
  ProfileHeaderEditFields,
  ProfileIdentity,
  ProfileTitle,
} from "@/components/profile/ProfileHeader";
import { ProfileInsights } from "@/components/profile/ProfileInsights";
import { ProfileMap } from "@/components/profile/ProfileMap";
import {
  RecentSubmissions,
  type PaginatedSubmissions,
} from "@/components/profile/RecentSubmissions";
import { DetectionsEntry } from "@/components/profile/DetectionsEntry";
import { OpenRequests } from "@/components/profile/OpenRequests";
import { useProfileEdit } from "@/components/profile/useProfileEdit";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { useDetectionsCount } from "@/contexts/DetectionsContext";

export default function ProfilePage() {
  const params = useParams();
  const { user: currentUser, loading: authLoading, logout, refresh } = useAuth();

  // Public read surface (`GET /users/{username}` is anonymous); only owner affordances gate on `currentUser`.
  const username = typeof params.username === "string" ? params.username : "";
  const {
    data: profile,
    error,
    refetch: refetchProfile,
  } = useApiResource<PublicProfile>(username ? `/users/${username}` : null);
  // Error deliberately unread: a failed list renders empty rather than blocking the profile card.
  const { data: submissionsData } = useApiResource<PaginatedSubmissions>(
    username ? `/users/${username}/events?per_page=5` : null
  );
  const submissions = submissionsData?.items ?? [];
  // The analyst's open calls, from the requests board's public list; error deliberately unread.
  const { data: openRequests } = useApiResource<EventListItem[]>(
    username
      ? eventListPath({
          view: "requested",
          status: "requested",
          author: username,
          // Same five rows as the submissions block.
          limit: 5,
        })
      : null
  );
  // Shared with the sidebar dot; owner-scoped server-side, so it is the signed-in user's count (gated to the own-profile render).
  const { count: detectionCount } = useDetectionsCount();

  const edit = useProfileEdit({
    username,
    profile,
    refreshAuth: refresh,
    refetchProfile,
  });

  // Two-click confirm against accidental taps; reverts after 3s. Signing out re-renders the anonymous profile, no redirect.
  const signOut = useConfirmAction(
    () => {
      logout();
    },
    { timeoutMs: 3000 }
  );

  // Wait for auth so owner affordances do not pop in after an anonymous-looking first paint.
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

  // Portfolio order: identity block (`ProfileIdentity`) and linked-account icons in the header actions
  // (`ProfileActions`), then the coverage map, Insights, recent submissions, open requests, sign out.
  // The detections entry is the exception: pending work, so it stays above the fold on the owner's profile.
  // Editing collapses the page to the form alone (bio and linked-accounts inputs contiguous, so Save stays on screen).
  const bio = edit.editing ? null : profile.bio?.trim() || null;
  const ownerEmail = isOwn ? currentUser?.email : undefined;
  return (
    <PageShell
      back
      title={<ProfileTitle profile={profile} edit={edit} />}
      // View mode always shows the metadata line; editing drops it, so the slot carries only the account email.
      subtitle={
        <ProfileIdentity
          bio={bio}
          email={ownerEmail}
          meta={edit.editing ? null : profile}
        />
      }
      actions={<ProfileActions profile={profile} isOwn={isOwn} edit={edit} />}
    >
      <ProfileHeaderEditFields profile={profile} edit={edit} />

      {!edit.editing && isOwn && detectionCount > 0 && (
        <DetectionsEntry username={profile.username} count={detectionCount} />
      )}

      <BioField edit={edit} />

      <LinkedAccountsFields edit={edit} />

      {!edit.editing && (
        <>
          <ProfileMap username={profile.username} />

          <ProfileInsights username={profile.username} />

          <CollectionsSection username={profile.username} isOwn={isOwn} />

          <RecentSubmissions
            profile={profile}
            submissions={submissions}
            isOwn={isOwn}
          />

          {openRequests && openRequests.length > 0 && (
            <OpenRequests profile={profile} requests={openRequests} />
          )}
        </>
      )}

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

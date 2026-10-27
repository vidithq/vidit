"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { eventListPath } from "@/lib/events";
import { userOrganizationsPath, type OrganizationMembership } from "@/lib/organizations";
import type { PublicProfile } from "@/lib/users";
import type { EventListItem } from "@/types";
import { CollectionsSection } from "@/components/collections/CollectionsSection";
import { BioField } from "@/components/profile/BioField";
import { LinkedAccountsFields } from "@/components/profile/LinkedAccounts";
import {
  OwnProfileActions,
  ProfileActions,
  ProfileEditActions,
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
import FollowButton from "@/components/profile/FollowButton";
import { OpenRequests } from "@/components/profile/OpenRequests";
import { useProfileEdit } from "@/components/profile/useProfileEdit";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { useDetectionsCount } from "@/contexts/DetectionsContext";

export default function ProfilePage() {
  const params = useParams();
  const { user: currentUser, loading: authLoading, refresh } = useAuth();

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
  // A failed read renders no logos, like the other optional blocks.
  const { data: organizations } = useApiResource<OrganizationMembership[]>(
    username ? userOrganizationsPath(username) : null
  );
  // The analyst's open calls, from the requests board's public list; error deliberately unread.
  const { data: openRequests } = useApiResource<EventListItem[]>(
    username
      ? eventListPath({
          view: "requested",
          statuses: ["requested"],
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

  // Portfolio order: identity block (`ProfileIdentity`, organization logos included) and linked-account
  // icons in the header actions (`ProfileActions`, with New collection and Sign out on your own), then
  // the coverage map, Insights, collections, recent submissions, open requests.
  // The detections entry is the exception: pending work, so it stays above the fold on the owner's profile.
  // Editing collapses the page to the form alone, with Cancel and Save pinned in the sticky actions.
  return (
    <PageShell
      back
      title={<ProfileTitle name={profile.username} edit={edit} />}
      subtitle={edit.editing ? undefined : <ProfileIdentity profile={profile} organizations={organizations} />}
      actions={
        !edit.editing && (
          <ProfileActions
            links={profile.external_links}
            canEdit={isOwn}
            edit={edit}
            icons={isOwn && <OwnProfileActions />}
          >
            {!isOwn && (
              <FollowButton
                username={profile.username}
                initialFollowing={profile.is_following}
              />
            )}
          </ProfileActions>
        )
      }
      stickyActions={edit.editing ? <ProfileEditActions edit={edit} /> : undefined}
    >
      <ProfileHeaderEditFields name={profile.username} edit={edit} />

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
    </PageShell>
  );
}

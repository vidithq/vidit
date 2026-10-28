"use client";

import { useParams } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { formatDate } from "@/lib/format";
import {
  answerOrganizationInvite,
  deleteOrganizationAvatar,
  memberCountLabel,
  organizationPath,
  updateOrganization,
  uploadOrganizationAvatar,
  type Organization,
  type OrganizationMember,
} from "@/lib/organizations";
import { BioField } from "@/components/profile/BioField";
import { LinkedAccountsFields } from "@/components/profile/LinkedAccounts";
import {
  IdentityLines,
  ProfileActions,
  ProfileEditActions,
  ProfileHeaderEditFields,
  ProfileTitle,
} from "@/components/profile/ProfileHeader";
import { useProfileEdit } from "@/components/profile/useProfileEdit";
import { OrganizationApprovals } from "@/components/organizations/OrganizationApprovals";
import { OrganizationInvites } from "@/components/organizations/OrganizationInvites";
import { OrganizationMembers } from "@/components/organizations/OrganizationMembers";
import { OrganizationApprovalRequests } from "@/components/organizations/OrganizationApprovalRequests";
import { InviteAnswerButtons } from "@/components/event/GeolocatorCredit";
import { Card } from "@/components/ui/Card";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";

/** An organization's public page: the analyst profile's header (name, picture, bio, links), then
 * the members, the approvals placed in its name, its approval requests for members, and its
 * invites for org managers. An invited viewer answers the invite in the header's actions. Org managers
 * edit the bio, links and picture in place, as an analyst edits their profile. */
export default function OrganizationPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const { user, loading: authLoading } = useAuth();

  const path = slug ? organizationPath(slug) : null;
  const { data: org, error, refetch } = useApiResource<Organization>(path);
  const { data: members, refetch: refetchMembers } = useApiResource<OrganizationMember[]>(
    path ? `${path}/members` : null,
  );

  const edit = useProfileEdit({
    username: slug,
    profile: org,
    refetchProfile: refetch,
    calls: {
      update: (body) => updateOrganization(slug, body),
      uploadAvatar: (file) => uploadOrganizationAvatar(slug, file),
      deleteAvatar: () => deleteOrganizationAvatar(slug),
    },
  });

  const reload = () => {
    refetch();
    refetchMembers();
  };

  if (authLoading) return <PageLoading />;
  if (error) return <PageError error={error} onRetry={refetch} backHref="/map" />;
  if (!org) return <PageLoading />;

  const segments = [
    memberCountLabel(org.member_count),
    ...(org.x_handle ? [`@${org.x_handle} on X`] : []),
    `Since ${formatDate(org.created_at)}`,
  ];

  return (
    <PageShell
      back
      title={<ProfileTitle name={org.name} edit={edit} />}
      subtitle={edit.editing ? undefined : <IdentityLines bio={org.bio} segments={segments} />}
      actions={
        !edit.editing && (
          <ProfileActions links={org.external_links} canEdit={org.viewer_can_manage} edit={edit}>
            {org.viewer_invited && (
              <InviteAnswerButtons
                answer={(choice) => answerOrganizationInvite(slug, choice)}
                onAnswered={reload}
              />
            )}
          </ProfileActions>
        )
      }
      stickyActions={edit.editing ? <ProfileEditActions edit={edit} /> : undefined}
    >
      {org.viewer_invited && !edit.editing && (
        <Card as="section">
          <p className="text-sm text-neutral-200">
            You are invited to join {org.name}. Accept or decline it at the top of the page.
          </p>
        </Card>
      )}

      <ProfileHeaderEditFields name={org.name} edit={edit} />

      <BioField edit={edit} owner="organization" />

      <LinkedAccountsFields edit={edit} />

      {!edit.editing && (
        <>
          {members && (
            <OrganizationMembers
              slug={slug}
              members={members}
              viewer={user?.username ?? null}
              canManage={org.viewer_can_manage}
              onChanged={reload}
            />
          )}

          <OrganizationApprovals slug={slug} />

          {org.viewer_role && <OrganizationApprovalRequests org={org} onChanged={refetch} />}

          {org.viewer_can_manage && <OrganizationInvites slug={slug} />}
        </>
      )}
    </PageShell>
  );
}

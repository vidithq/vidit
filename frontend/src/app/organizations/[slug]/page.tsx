"use client";

import { useParams } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { formatDate } from "@/lib/format";
import {
  answerOrganizationInvite,
  deleteOrganizationAvatar,
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
  ProfileHeaderEditFields,
  ProfileTitle,
} from "@/components/profile/ProfileHeader";
import { useProfileEdit } from "@/components/profile/useProfileEdit";
import { OrganizationApprovals } from "@/components/organizations/OrganizationApprovals";
import { OrganizationInvites } from "@/components/organizations/OrganizationInvites";
import { OrganizationMembers } from "@/components/organizations/OrganizationMembers";
import { OrganizationReviewRequests } from "@/components/organizations/OrganizationReviewRequests";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageError, PageLoading, PageShell } from "@/components/ui/PageShell";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

/** An organization's public page: the analyst profile's header (name, picture, bio, links), then
 * the invite answer for an invited viewer, the members, the approvals placed in its name, and,
 * for org-admins and site admins, its review requests and invites. Org-admins and site admins
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
  const answer = useMutation(
    (choice: "accept" | "decline") => answerOrganizationInvite(slug, choice),
    { fallback: "Could not answer the invite", onSuccess: reload },
  );

  if (authLoading) return <PageLoading />;
  if (error) return <PageError message={error} backHref="/map" />;
  if (!org) return <PageLoading />;

  const segments = [
    `${org.member_count} member${org.member_count === 1 ? "" : "s"}`,
    ...(org.x_handle ? [`@${org.x_handle} on X`] : []),
    `Since ${formatDate(org.created_at)}`,
  ];

  return (
    <PageShell
      back
      title={<ProfileTitle name={org.name} edit={edit} />}
      subtitle={edit.editing ? undefined : <IdentityLines bio={org.bio} segments={segments} />}
      actions={
        <ProfileActions links={org.external_links} canEdit={org.viewer_can_manage} edit={edit} />
      }
    >
      <ProfileHeaderEditFields name={org.name} edit={edit} />

      <BioField edit={edit} />

      <LinkedAccountsFields edit={edit} />

      {!edit.editing && (
        <>
          {org.viewer_invited && (
            <Card as="section">
              <p className="text-sm text-neutral-200">
                You are invited to join {org.name}.
              </p>
              {answer.error && <div className={FORM_ERROR_BANNER}>{answer.error}</div>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void answer.run("accept")} disabled={answer.loading}>
                  Accept
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void answer.run("decline")}
                  disabled={answer.loading}
                >
                  Decline
                </Button>
              </div>
            </Card>
          )}

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

          {org.viewer_can_manage && <OrganizationReviewRequests org={org} onChanged={refetch} />}

          {org.viewer_can_manage && (
            <OrganizationInvites slug={slug} canInvite={org.viewer_role === "admin"} />
          )}
        </>
      )}
    </PageShell>
  );
}

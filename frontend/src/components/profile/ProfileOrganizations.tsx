import {
  ROLE_LABEL,
  organizationPath,
  type OrganizationMembership,
} from "@/lib/organizations";
import { AvatarStack } from "@/components/ui/AvatarStack";

/** The analyst's organizations as logos in the profile header. Each links to its organization's
 * page; hover or focus names the organization and the analyst's role in it. */
export function ProfileOrganizations({ memberships }: { memberships: OrganizationMembership[] }) {
  return (
    <AvatarStack
      label="Organizations"
      items={memberships.map(({ organization, role }) => ({
        key: organization.slug,
        name: organization.name,
        avatarUrl: organization.avatar_url,
        variant: "organization",
        label: `${ROLE_LABEL[role]} of ${organization.name}`,
        href: organizationPath(organization.slug),
      }))}
    />
  );
}

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
      max={memberships.length}
      items={memberships.map(({ organization, role }) => ({
        key: organization.slug,
        name: organization.name,
        avatarUrl: organization.avatar_url,
        variant: "organization",
        label: `${ROLE_LABEL[role]} of ${organization.name}`,
        href: organizationPath(organization.slug),
        renderCard: () => (
          <>
            <span className="block font-medium text-neutral-100">{organization.name}</span>
            <span className="block text-neutral-500">{ROLE_LABEL[role]}</span>
          </>
        ),
      }))}
    />
  );
}

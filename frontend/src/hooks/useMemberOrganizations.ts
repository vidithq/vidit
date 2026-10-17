import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import {
  userOrganizationsPath,
  type OrganizationMembership,
  type OrganizationRef,
} from "@/lib/organizations";

const NONE: OrganizationRef[] = [];

/** The organizations the signed-in analyst is a member of, the ones they act for (approve, revoke
 *  its approval, answer its approval requests), whatever their role. Empty while loading and when
 *  signed out. Mirrors backend organizations.is_organization_member; change both. */
export function useMemberOrganizations(): OrganizationRef[] {
  const { user } = useAuth();
  const { data } = useApiResource<OrganizationMembership[]>(
    user ? userOrganizationsPath(user.username) : null,
  );
  if (!data) return NONE;
  return data.map((m) => m.organization);
}

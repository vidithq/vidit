import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import {
  userOrganizationsPath,
  type OrganizationMembership,
  type OrganizationRef,
} from "@/lib/organizations";

const NONE: OrganizationRef[] = [];

/** The organizations the signed-in analyst is an org manager of, the ones they act for (approve,
 *  answer a review request, revoke an approval). Empty while loading and when signed out. */
export function useManagedOrganizations(): OrganizationRef[] {
  const { user } = useAuth();
  const { data } = useApiResource<OrganizationMembership[]>(
    user ? userOrganizationsPath(user.username) : null,
  );
  if (!data) return NONE;
  return data.filter((m) => m.role === "manager").map((m) => m.organization);
}

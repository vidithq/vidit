"use client";

import { Building2 } from "lucide-react";

import { useApiResource } from "@/hooks/useApiResource";
import {
  ROLE_LABEL,
  organizationPath,
  userOrganizationsPath,
  type OrganizationMembership,
} from "@/lib/organizations";
import { Card } from "@/components/ui/Card";
import { LinkRow } from "@/components/ui/LinkRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

/** The organizations the analyst belongs to, one link row each with their role. Nothing when
 * they belong to none; a failed read renders nothing too, like the other optional blocks. */
export function ProfileOrganizations({ username }: { username: string }) {
  const { data } = useApiResource<OrganizationMembership[]>(userOrganizationsPath(username));
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <SectionEyebrow title="Organizations" margin="none" />
      <div className="space-y-2">
        {data.map(({ organization, role }) => (
          <LinkRow
            key={organization.slug}
            icon={Building2}
            label={ROLE_LABEL[role]}
            value={organization.name}
            href={organizationPath(organization.slug)}
            external={false}
          />
        ))}
      </div>
    </Card>
  );
}

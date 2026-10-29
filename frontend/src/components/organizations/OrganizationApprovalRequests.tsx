"use client";

import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { formatDate } from "@/lib/format";
import { eventItem } from "@/lib/items";
import { updateOrganization, type Organization } from "@/lib/organizations";
import {
  ORGANIZATION_AUDIENCE_OPTIONS,
  APPROVAL_REQUEST_AUDIENCE_DEFAULT,
  declineApprovalRequest,
  organizationApprovalRequestsPath,
  type OrganizationApprovalRequest,
  type ApprovalRequestAudience,
} from "@/lib/approvalRequests";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChoiceRow } from "@/components/ui/ChoiceRow";
import { Item } from "@/components/ui/Item";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/** One open request as an item to its event: when it was asked, by whom, the version, and
 *  Decline. Approving happens on the event page, after reading it. */
function RequestRow({
  item: { event, request },
  onAnswered,
}: {
  item: OrganizationApprovalRequest;
  onAnswered: () => void;
}) {
  const decline = useMutation(() => declineApprovalRequest(event.id, request.id), {
    fallback: "Failed to decline the approval request",
    onSuccess: onAnswered,
  });
  return (
    <li className="space-y-2">
      <Item
        variant="list"
        {...eventItem(event)}
        date={formatDate(request.created_at)}
        analyst={{ author: request.requester }}
        extra={[`v${request.version_no}`]}
        actions={
          <Button
            action="remove"
            variant="ghost"
            onClick={() => void decline.run()}
            disabled={decline.loading}
          >
            Decline
          </Button>
        }
      />
      {decline.error && (
        <ErrorNotice error={decline.error} />
      )}
    </li>
  );
}

/**
 * The organization's approval requests, for its members: the open requests, oldest first, and, for
 * its org managers, who may send one (the organization's audience, which they set here). Any member
 * declines a request here, or approves it in the organization's name from the event page.
 */
export function OrganizationApprovalRequests({
  org,
  onChanged,
}: {
  org: Organization;
  onChanged: () => void;
}) {
  const requests = useApiResource<OrganizationApprovalRequest[]>(
    organizationApprovalRequestsPath(org.slug),
  );
  const audience = useMutation(
    (value: ApprovalRequestAudience) =>
      updateOrganization(org.slug, { approval_request_audience: value }),
    { fallback: "Could not change who can send approval requests", onSuccess: onChanged },
  );
  const rows = requests.data ?? [];
  const error = audience.error ?? requests.error;

  return (
    <Card as="section">
      <SectionEyebrow title="Approval requests" margin="none" />
      {org.viewer_can_manage && (
        <ChoiceRow
          label="Accept approval requests from"
          description={`Who can ask ${org.name} to approve their geolocation.`}
          options={ORGANIZATION_AUDIENCE_OPTIONS}
          value={org.approval_request_audience ?? APPROVAL_REQUEST_AUDIENCE_DEFAULT}
          onChange={(value) => void audience.run(value)}
        />
      )}
      {error && <ErrorNotice error={error} />}
      {requests.data && rows.length === 0 && (
        <p className="text-sm text-neutral-500">No open requests.</p>
      )}
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((item) => (
            <RequestRow
              key={item.request.id}
              item={item}
              onAnswered={requests.refetch}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

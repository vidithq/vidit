"use client";

import { ClipboardCheck } from "lucide-react";

import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { formatDate } from "@/lib/format";
import { updateOrganization, type Organization } from "@/lib/organizations";
import {
  ORGANIZATION_AUDIENCE_OPTIONS,
  APPROVAL_REQUEST_AUDIENCE_DEFAULT,
  declineApprovalRequest,
  organizationApprovalRequestsPath,
  type OrganizationApprovalRequest,
  type ApprovalRequestAudience,
} from "@/lib/approvalRequests";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LinkRow } from "@/components/ui/LinkRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { eventHref } from "@/lib/routes";

/** One open request as a row to its event: the requester's picture, the event title, who asked
 *  and when, and Decline. Approving happens on the event page, after reading it. */
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
  const requester = request.requester;
  return (
    <li className="space-y-2">
      <LinkRow
        variant="arrow"
        icon={ClipboardCheck}
        leading={
          <Avatar src={requester.avatar_url} username={requester.username} size="size-7" decorative />
        }
        value={event.title}
        meta={
          <span>
            v{request.version_no} · asked by {requester.username} on{" "}
            {formatDate(request.created_at)}
          </span>
        }
        href={eventHref(event.id)}
        external={false}
        action={
          <Button variant="ghost" onClick={() => void decline.run()} disabled={decline.loading}>
            Decline
          </Button>
        }
      />
      {decline.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {decline.error}
        </div>
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
      {/* Stacks below `sm`, where the three choices take the full column. */}
      {org.viewer_can_manage && (
        <div className="flex max-sm:flex-col max-sm:items-stretch items-center justify-between gap-4">
          <div>
            <p className="text-sm text-neutral-200">Accept approval requests from</p>
            <p className="text-xs text-neutral-500">
              Who can ask {org.name} to approve their geolocation.
            </p>
          </div>
          <SegmentedControl
            aria-label="Accept approval requests from"
            options={ORGANIZATION_AUDIENCE_OPTIONS}
            value={org.approval_request_audience ?? APPROVAL_REQUEST_AUDIENCE_DEFAULT}
            onChange={(value) => void audience.run(value)}
          />
        </div>
      )}
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
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

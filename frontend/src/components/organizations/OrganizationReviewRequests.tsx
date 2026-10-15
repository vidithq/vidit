"use client";

import Link from "next/link";

import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import { formatDate } from "@/lib/format";
import { setOrganizationReviewRequestAudience, type Organization } from "@/lib/organizations";
import {
  ORGANIZATION_AUDIENCE_OPTIONS,
  REVIEW_REQUEST_AUDIENCE_DEFAULT,
  organizationReviewRequestsPath,
  type OrganizationReviewRequest,
  type ReviewRequestAudience,
} from "@/lib/reviewRequests";
import { ReviewRequestDecline } from "@/components/event/ReviewRequestsSection";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";

/**
 * The organization's review requests, for its org-admins and site admins: who may send one (the
 * organization's audience, which they set here), and the open requests, oldest first. An
 * org-admin declines a request here, or approves it in the organization's name from the event
 * page. A site admin who is not an org-admin reads the list without answering.
 */
export function OrganizationReviewRequests({
  org,
  onChanged,
}: {
  org: Organization;
  onChanged: () => void;
}) {
  const requests = useApiResource<OrganizationReviewRequest[]>(
    organizationReviewRequestsPath(org.slug),
  );
  const audience = useMutation(
    (value: ReviewRequestAudience) => setOrganizationReviewRequestAudience(org.slug, value),
    { fallback: "Could not change who can send review requests", onSuccess: onChanged },
  );
  const rows = requests.data ?? [];
  const canAnswer = org.viewer_role === "admin";
  const error = audience.error ?? requests.error;

  return (
    <Card as="section">
      <SectionEyebrow title="Review requests" margin="none" />
      {/* Stacks below `sm`, where the three choices take the full column. */}
      <div className="flex max-sm:flex-col max-sm:items-stretch items-center justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-200">Accept review requests from</p>
          <p className="text-xs text-neutral-500">
            Who can ask {org.name} to review their geolocation.
          </p>
        </div>
        <SegmentedControl
          aria-label="Accept review requests from"
          options={ORGANIZATION_AUDIENCE_OPTIONS}
          value={org.review_request_audience ?? REVIEW_REQUEST_AUDIENCE_DEFAULT}
          onChange={(value) => void audience.run(value)}
        />
      </div>
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {requests.data && rows.length === 0 && (
        <p className="text-sm text-neutral-500">No open requests.</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-neutral-800">
          {rows.map(({ event, request }) => (
            <li key={request.id} className="space-y-2 py-2">
              <Link
                href={`/events/${event.id}`}
                className={`${TEXT_LINK} text-sm [overflow-wrap:anywhere]`}
              >
                {event.title}
              </Link>
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                asked by <AuthorByline author={request.requester} prefix={false} /> on{" "}
                {formatDate(request.created_at)}
              </p>
              {canAnswer && (
                <ReviewRequestDecline
                  eventId={event.id}
                  requestId={request.id}
                  onAnswered={requests.refetch}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";

import type { EventDetail } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useAdministeredOrganizations } from "@/hooks/useAdministeredOrganizations";
import { useApiResource } from "@/hooks/useApiResource";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
import { useMutation } from "@/hooks/useMutation";
import { approveEvent, approveLabel } from "@/lib/approvals";
import { formatDate } from "@/lib/format";
import { organizationByline, type OrganizationRef } from "@/lib/organizations";
import {
  canRequestReview,
  declineReviewRequest,
  requestReview,
  reviewRequestTargetsPath,
  reviewRequestsPath,
  type ReviewRequest,
  type ReviewRequestTarget,
  type ReviewRequestTargets,
} from "@/lib/reviewRequests";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";

/**
 * The target's answer to an open review request: the notification row and the event page both
 * render it. Approving covers `versionNo`, the live version, as the reader or for
 * `organization` when the request asks one, and resolves the request; without a `versionNo` only
 * Decline shows (the event page approves from its Approvals card).
 */
export function ReviewRequestAnswer({
  eventId,
  requestId,
  versionNo,
  organization = null,
  onAnswered,
}: {
  eventId: string;
  requestId: string;
  versionNo: number | null;
  organization?: OrganizationRef | null;
  onAnswered: () => void;
}) {
  const answer = useMutation(
    async (verb: "approve" | "decline") => {
      if (verb === "approve" && versionNo !== null) {
        await approveEvent(eventId, versionNo, undefined, organization?.slug);
      } else await declineReviewRequest(eventId, requestId);
    },
    { fallback: "Failed to answer the review request", onSuccess: onAnswered },
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {versionNo !== null && (
          <Button onClick={() => void answer.run("approve")} disabled={answer.loading}>
            {approveLabel(versionNo, organization)}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => void answer.run("decline")}
          disabled={answer.loading}
        >
          Decline
        </Button>
      </div>
      {answer.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {answer.error}
        </div>
      )}
    </div>
  );
}

/** Who a request asks, as a byline: the analyst, or the organization with its picture and page. */
function TargetByline({ request }: { request: ReviewRequest }) {
  const target = request.target_organization
    ? organizationByline(request.target_organization)
    : request.target;
  if (!target) return null;
  return <AuthorByline author={target} prefix={false} avatar className="min-w-0" />;
}

/** One open request: who is asked, by whom, and since when. */
function RequestRow({ request }: { request: ReviewRequest }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <TargetByline request={request} />
      <span className="text-[11px] text-neutral-500">
        asked by {request.requester.username} on {formatDate(request.created_at)}
      </span>
    </div>
  );
}

const TARGET_FIELD_ID = "review-request-target";
// Not a fetch per keystroke, but up by the time typing stops.
const TARGET_QUERY_DEBOUNCE_MS = 250;

/** One suggestion of the picker: what the request posts, and the name its Pill shows. */
type TargetOption = { key: string; label: string; target: ReviewRequestTarget };

function targetOptions(targets: ReviewRequestTargets | null): TargetOption[] {
  if (!targets) return [];
  return [
    ...targets.analysts.map((a) => ({
      key: `user:${a.username}`,
      label: a.username,
      target: { username: a.username },
    })),
    ...targets.organizations.map((o) => ({
      key: `organization:${o.slug}`,
      label: o.name,
      target: { organization: o.slug },
    })),
  ];
}

/** The geolocator's picker: analysts who follow the reader, organizations an org-admin of which
 *  follows them, and an exact username or slug, whose request may still be refused. */
function RequestReviewForm({ eventId, onSent }: { eventId: string; onSent: () => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<TargetOption | null>(null);
  useDebouncedEffect(() => setDebounced(query.trim()), [query], TARGET_QUERY_DEBOUNCE_MS);
  const targets = useApiResource<ReviewRequestTargets>(
    reviewRequestTargetsPath(eventId, debounced),
  );
  const send = useMutation((target: ReviewRequestTarget) => requestReview(eventId, target), {
    fallback: "Failed to send the review request",
    onSuccess: () => {
      setQuery("");
      setSelected(null);
      targets.refetch();
      onSent();
    },
  });

  const options = targetOptions(targets.data);
  return (
    <div className="space-y-2">
      <label htmlFor={TARGET_FIELD_ID} className={FORM_LABEL}>
        Ask an analyst or an organization to review this version
      </label>
      <Input
        id={TARGET_FIELD_ID}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
        placeholder="Search analysts and organizations"
        autoComplete="off"
      />
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <Pill
              key={option.key}
              tone={selected?.key === option.key ? "accent" : "neutral"}
              onClick={() => setSelected(option)}
            >
              {option.label}
            </Pill>
          ))}
        </div>
      ) : (
        targets.data && (
          <p className="text-xs text-neutral-500">
            No analyst or organization to suggest. Suggestions are analysts who follow you and
            organizations whose org-admins follow you. Type an exact username or slug to ask
            someone else.
          </p>
        )
      )}
      <Button
        onClick={() => selected && void send.run(selected.target)}
        disabled={send.loading || !selected}
      >
        {selected ? `Ask ${selected.label}` : "Ask for a review"}
      </Button>
      {(send.error || targets.error) && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {send.error ?? targets.error}
        </div>
      )}
    </div>
  );
}

/**
 * Review requests on a published event. A geolocator sees the open requests and asks an analyst
 * or an organization to review the live version; an analyst asked, or an org-admin of an
 * organization asked, sees the request and can decline it, or approve from the Approvals card.
 * `refreshKey` changes when an approval elsewhere on the page may have resolved a request.
 */
export function ReviewRequestsSection({
  event,
  refreshKey,
}: {
  event: EventDetail;
  refreshKey: number;
}) {
  const { user } = useAuth();
  const administered = useAdministeredOrganizations();
  const geolocator = canRequestReview(event, user?.id);
  const requests = useApiResource<ReviewRequest[]>(
    user && event.status === "geolocated" ? reviewRequestsPath(event.id) : null,
  );
  const [asking, setAsking] = useState(false);
  const { refetch } = requests;
  useEffect(() => {
    if (refreshKey > 0) refetch();
  }, [refreshKey, refetch]);

  const rows = requests.data ?? [];
  const mine = rows.filter((r) =>
    r.target_organization
      ? administered.some((o) => o.slug === r.target_organization?.slug)
      : r.target?.id === user?.id,
  );
  if (!geolocator && mine.length === 0) return null;

  return (
    <Card as="section">
      <SectionEyebrow title="Review requests" margin="none" />
      {mine.map((request) => (
        <div key={request.id} className="space-y-2">
          <p className="text-sm text-neutral-300">
            <AuthorByline author={request.requester} prefix={false} /> asks{" "}
            {request.target_organization ? request.target_organization.name : "you"} to review
            this geolocation. Approve it
            {request.target_organization ? ` as ${request.target_organization.name}` : ""} in the
            Approvals card, or decline.
          </p>
          <ReviewRequestAnswer
            eventId={event.id}
            requestId={request.id}
            versionNo={null}
            onAnswered={refetch}
          />
        </div>
      ))}
      {geolocator && (
        <>
          {rows.length > 0 ? (
            <div className="divide-y divide-neutral-800">
              {rows.map((request) => (
                <RequestRow key={request.id} request={request} />
              ))}
            </div>
          ) : (
            requests.data && <p className="text-sm text-neutral-500">No open requests.</p>
          )}
          {asking ? (
            <RequestReviewForm eventId={event.id} onSent={refetch} />
          ) : (
            <Button variant="secondary" onClick={() => setAsking(true)}>
              Request a review
            </Button>
          )}
        </>
      )}
      {requests.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {requests.error}
        </div>
      )}
    </Card>
  );
}

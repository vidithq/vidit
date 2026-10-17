"use client";

import { useEffect, useState } from "react";

import type { EventDetail } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useManagedOrganizations } from "@/hooks/useManagedOrganizations";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { useMutation } from "@/hooks/useMutation";
import { formatDate } from "@/lib/format";
import { organizationByline, type OrganizationRef } from "@/lib/organizations";
import {
  canRequestApproval,
  declineApprovalRequest,
  requestApproval,
  approvalRequestTargetsPath,
  approvalRequestsPath,
  type ApprovalRequest,
  type ApprovalRequestTarget,
  type ApprovalRequestTargets,
} from "@/lib/approvalRequests";
import {
  AccountPicker,
  accountName,
  analystAccount,
  type Account,
} from "@/components/ui/AccountPicker";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER, FORM_LABEL } from "@/components/ui/form-styles";

/**
 * The target's answer to an open approval request outside the approve form: Decline. The
 * notification row, the event page and the organization page render it; approving happens in
 * the event page's Approvals card, after reading the event.
 */
export function ApprovalRequestDecline({
  eventId,
  requestId,
  onAnswered,
}: {
  eventId: string;
  requestId: string;
  onAnswered: () => void;
}) {
  const decline = useMutation(() => declineApprovalRequest(eventId, requestId), {
    fallback: "Failed to decline the approval request",
    onSuccess: onAnswered,
  });
  return (
    <div className="space-y-2">
      <Button variant="ghost" onClick={() => void decline.run()} disabled={decline.loading}>
        Decline
      </Button>
      {decline.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {decline.error}
        </div>
      )}
    </div>
  );
}

/** Who a request asks, as a byline: the analyst, or the organization with its picture and page. */
function TargetByline({ request }: { request: ApprovalRequest }) {
  const target = request.target_organization
    ? organizationByline(request.target_organization)
    : request.target;
  if (!target) return null;
  return <AuthorByline author={target} prefix={false} avatar className="min-w-0" />;
}

/** One open request: who is asked, by whom, and since when. */
function RequestRow({ request }: { request: ApprovalRequest }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <TargetByline request={request} />
      <span className="text-[11px] text-neutral-500">
        asked by {request.requester.username} on {formatDate(request.created_at)}
      </span>
    </div>
  );
}

const TARGET_FIELD_ID = "approval-request-target";

function targetOf(account: Account): ApprovalRequestTarget {
  return account.kind === "analyst"
    ? { username: account.username }
    : { organization: account.slug };
}

function searchTargets(eventId: string, query: string) {
  return apiFetch<ApprovalRequestTargets>(approvalRequestTargetsPath(eventId, query)).then(
    (targets) => ({
      accounts: [
        ...targets.analysts.map(analystAccount),
        ...targets.organizations.map((o): Account => ({ kind: "organization", ...o })),
      ],
      note: targets.refusal,
    }),
  );
}

/** The geolocator's picker: analysts who follow the reader, organizations an org manager of which
 *  follows them, and an exact username or slug, whose request may still be refused. An exact match
 *  the server leaves out shows its refusal as the list's muted row. */
function RequestApprovalForm({
  eventId,
  onSent,
  onCancel,
}: {
  eventId: string;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Account | null>(null);
  const send = useMutation((target: ApprovalRequestTarget) => requestApproval(eventId, target), {
    fallback: "Failed to send the approval request",
    onSuccess: () => {
      setSelected(null);
      onSent();
    },
  });

  return (
    <div className="space-y-2">
      <label htmlFor={TARGET_FIELD_ID} className={FORM_LABEL}>
        Ask an analyst or an organization to approve this version
      </label>
      <AccountPicker
        id={TARGET_FIELD_ID}
        search={(query) => searchTargets(eventId, query)}
        selected={selected}
        onSelect={setSelected}
        onClear={() => {
          setSelected(null);
          send.reset();
        }}
        onQueryChange={send.reset}
        placeholder="Search analysts and organizations"
        emptyText="No analyst or organization to suggest. Suggestions are analysts who follow you and organizations whose org managers follow you. Type an exact username or slug to ask someone else."
        autoFocus
      />
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => selected && void send.run(targetOf(selected))}
          disabled={send.loading || !selected}
        >
          {selected ? `Ask ${accountName(selected)}` : "Ask for approval"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={send.loading}>
          Cancel
        </Button>
      </div>
      {send.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {send.error}
        </div>
      )}
    </div>
  );
}

/**
 * Approval requests on a published event, the last section of its Approvals card. A geolocator
 * sees the open requests and asks an analyst or an organization to approve the live version; an
 * analyst asked, or an org manager of an organization asked, sees the request and can decline it,
 * or approve with **Approve** above it. `refreshKey` changes when an approval may have resolved a
 * request.
 */
export function ApprovalRequestsSection({
  event,
  refreshKey,
}: {
  event: EventDetail;
  refreshKey: number;
}) {
  const { user } = useAuth();
  const managed = useManagedOrganizations();
  const geolocator = canRequestApproval(event, user?.id);
  const requests = useApiResource<ApprovalRequest[]>(
    user && event.status === "geolocated" ? approvalRequestsPath(event.id) : null,
  );
  const [asking, setAsking] = useState(false);
  const { refetch } = requests;
  useEffect(() => {
    if (refreshKey > 0) refetch();
  }, [refreshKey, refetch]);

  const rows = requests.data ?? [];
  const mine = rows.filter((r) =>
    r.target_organization
      ? managed.some((o) => o.slug === r.target_organization?.slug)
      : r.target?.id === user?.id,
  );
  if (!geolocator && mine.length === 0) return null;

  return (
    <section className="space-y-3 border-t border-neutral-800 pt-4">
      <SectionEyebrow as="h3" title="Approval requests" margin="none" />
      {mine.map((request) => (
        <div key={request.id} className="space-y-2">
          <p className="text-sm text-neutral-300">
            <AuthorByline author={request.requester} prefix={false} /> asks{" "}
            {request.target_organization ? request.target_organization.name : "you"} to approve
            this geolocation. Approve it
            {request.target_organization ? ` as ${request.target_organization.name}` : ""} above,
            or decline.
          </p>
          <ApprovalRequestDecline eventId={event.id} requestId={request.id} onAnswered={refetch} />
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
            <RequestApprovalForm
              eventId={event.id}
              onSent={() => {
                setAsking(false);
                refetch();
              }}
              onCancel={() => setAsking(false)}
            />
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setAsking(true)}>
                Request approval
              </Button>
            </div>
          )}
        </>
      )}
      {requests.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {requests.error}
        </div>
      )}
    </section>
  );
}

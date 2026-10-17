"use client";

import { useEffect, useState } from "react";

import type { EventDetail } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useManagedOrganizations } from "@/hooks/useManagedOrganizations";
import { useApiResource } from "@/hooks/useApiResource";
import { useDebouncedEffect } from "@/hooks/useDebouncedEffect";
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
import { cn } from "@/lib/cn";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Tooltip } from "@/components/ui/Tooltip";
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
// Not a fetch per keystroke, but up by the time typing stops.
const TARGET_QUERY_DEBOUNCE_MS = 250;

/** One suggestion of the picker: what the request posts, and the name its Pill shows. */
type TargetOption = { key: string; label: string; target: ApprovalRequestTarget };

function targetOptions(targets: ApprovalRequestTargets | null): TargetOption[] {
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

/** The geolocator's picker: analysts who follow the reader, organizations an org manager of which
 *  follows them, and an exact username or slug, whose request may still be refused. */
function RequestApprovalForm({
  eventId,
  onSent,
  onCancel,
}: {
  eventId: string;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<TargetOption | null>(null);
  useDebouncedEffect(() => setDebounced(query.trim()), [query], TARGET_QUERY_DEBOUNCE_MS);
  const targets = useApiResource<ApprovalRequestTargets>(
    approvalRequestTargetsPath(eventId, debounced),
  );
  const send = useMutation((target: ApprovalRequestTarget) => requestApproval(eventId, target), {
    fallback: "Failed to send the approval request",
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
        Ask an analyst or an organization to approve this version
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
        autoFocus
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
            organizations whose org managers follow you. Type an exact username or slug to ask
            someone else.
          </p>
        )
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => selected && void send.run(selected.target)}
          disabled={send.loading || !selected}
        >
          {selected ? `Ask ${selected.label}` : "Ask for approval"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={send.loading}>
          Cancel
        </Button>
      </div>
      {(send.error || targets.error) && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {send.error ?? targets.error}
        </div>
      )}
    </div>
  );
}

/** The open approval requests on a published event, and `mine`: those addressed to the reader or
 *  to an organization they manage. `refreshKey` changes when an approval may have resolved one. */
export function useApprovalRequests(event: EventDetail, refreshKey: number) {
  const { user } = useAuth();
  const managed = useManagedOrganizations();
  const requests = useApiResource<ApprovalRequest[]>(
    user && event.status === "geolocated" ? approvalRequestsPath(event.id) : null,
  );
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
  return { requests, rows, mine };
}

type ApprovalRequests = ReturnType<typeof useApprovalRequests>;

/** Who asked the reader for approval, one line for the reader and one per organization they
 *  manage: "maya and jules asked for your approval". */
export function IncomingRequests({ requests }: { requests: ApprovalRequest[] }) {
  const personal = requests.filter((r) => !r.target_organization).map((r) => r.requester);
  const organizations = new Map<string, { organization: OrganizationRef; requesters: ApprovalRequest["requester"][] }>();
  for (const r of requests) {
    if (!r.target_organization) continue;
    const group = organizations.get(r.target_organization.slug) ?? {
      organization: r.target_organization,
      requesters: [],
    };
    group.requesters.push(r.requester);
    organizations.set(r.target_organization.slug, group);
  }
  return (
    <div className="space-y-1.5 text-sm text-neutral-300">
      {personal.length > 0 && (
        <p>
          <AuthorByline author={personal[0]} coAuthors={personal.slice(1)} avatar prefix={false} />{" "}
          asked for your approval
        </p>
      )}
      {[...organizations.values()].map(({ organization, requesters }) => (
        <p key={organization.slug}>
          <AuthorByline author={requesters[0]} coAuthors={requesters.slice(1)} prefix={false} />{" "}
          asked{" "}
          <AuthorByline author={organizationByline(organization)} avatar prefix={false} /> for
          approval
        </p>
      ))}
    </div>
  );
}

/** **Decline** beside **Approve**: declines every request addressed to the reader. */
export function DeclineRequests({
  eventId,
  requests,
  onAnswered,
}: {
  eventId: string;
  requests: ApprovalRequest[];
  onAnswered: () => void;
}) {
  const decline = useMutation(
    async () => {
      for (const request of requests) await declineApprovalRequest(eventId, request.id);
    },
    {
      fallback: "Failed to decline the approval request",
      onSuccess: onAnswered,
      // A failure part way leaves the earlier requests declined: refetch so the rows say so.
      onError: () => {
        onAnswered();
        return undefined;
      },
    },
  );
  return (
    <>
      <Tooltip
        label={
          requests.length === 1
            ? "Declines the request. The requester is notified."
            : "Declines every request. Each requester is notified."
        }
      >
        <Button variant="ghost" onClick={() => void decline.run()} disabled={decline.loading}>
          Decline
        </Button>
      </Tooltip>
      {decline.error && (
        <div className={cn(FORM_ERROR_BANNER, "basis-full")} role="alert">
          {decline.error}
        </div>
      )}
    </>
  );
}

/**
 * A geolocator's approval requests on a published event, the last section of its Approvals card:
 * the open requests, and a form that asks an analyst or an organization to approve the live
 * version.
 */
export function ApprovalRequestsSection({
  event,
  requests: { requests, rows },
}: {
  event: EventDetail;
  requests: ApprovalRequests;
}) {
  const { user } = useAuth();
  const geolocator = canRequestApproval(event, user?.id);
  const [asking, setAsking] = useState(false);
  const { refetch } = requests;
  if (!geolocator) return null;

  return (
    <section className="space-y-3 border-t border-neutral-800 pt-4">
      <SectionEyebrow as="h3" title="Approval requests" margin="none" />
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
      {requests.error && (
        <div className={FORM_ERROR_BANNER} role="alert">
          {requests.error}
        </div>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";

import type { EventDetail } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { useMutation } from "@/hooks/useMutation";
import { formatDate } from "@/lib/format";
import { organizationByline, type OrganizationRef } from "@/lib/organizations";
import {
  declineApprovalRequest,
  requestApproval,
  approvalRequestTargetsPath,
  approvalRequestsPath,
  type ApprovalRequest,
  type ApprovalRequestTarget,
  type ApprovalRequestTargets,
} from "@/lib/approvalRequests";
import { cn } from "@/lib/cn";
import {
  accountKey,
  accountName,
  analystAccount,
  type Account,
} from "@/lib/accounts";
import { ItemSearch } from "@/components/ui/ItemSearch";
import { accountItem } from "@/lib/items";
import { AuthorByline } from "@/components/ui/AuthorByline";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { FORM_LABEL } from "@/components/ui/form-styles";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

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
      rows: [
        ...targets.analysts.map(analystAccount),
        ...targets.organizations.map((o): Account => ({ kind: "organization", ...o })),
      ],
      note: targets.refusal,
    }),
  );
}

/** The open approval requests on a published event, and `mine`: those addressed to the reader or
 *  to an organization in `memberOf`. `refreshKey` changes when an approval may have resolved one.
 *  Reads nothing while `event` is null. */
export function useApprovalRequests(
  event: EventDetail | null,
  memberOf: OrganizationRef[],
  refreshKey: number,
) {
  const { user } = useAuth();
  const requests = useApiResource<ApprovalRequest[]>(
    user && event?.status === "geolocated" ? approvalRequestsPath(event.id) : null,
  );
  const { refetch } = requests;
  useEffect(() => {
    if (refreshKey > 0) refetch();
  }, [refreshKey, refetch]);
  const rows = requests.data ?? [];
  const mine = rows.filter((r) =>
    r.target_organization
      ? memberOf.some((o) => o.slug === r.target_organization?.slug)
      : r.target?.id === user?.id,
  );
  return { requests, rows, mine };
}

type ApprovalRequests = ReturnType<typeof useApprovalRequests>;

/** Who asked the reader for approval, one line for the reader and one per organization they
 *  belong to: each requester's picture and name, then "asked for your approval". */
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
          <AuthorByline author={requesters[0]} coAuthors={requesters.slice(1)} avatar prefix={false} />{" "}
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
        <Button
          action="remove"
          variant="ghost"
          onClick={() => void decline.run()}
          disabled={decline.loading}
        >
          Decline
        </Button>
      </Tooltip>
      {decline.error && (
        <ErrorNotice error={decline.error} className="basis-full" />
      )}
    </>
  );
}

/** The geolocator's dialog: the open requests, then a picker over analysts who follow the
 *  reader, organizations an org manager of which follows them, and an exact username or slug,
 *  whose request may still be refused. An exact match the server leaves out shows its refusal as
 *  the list's muted row. A sent request closes the dialog and rereads the open requests. */
function RequestApprovalDialog({
  eventId,
  requests: { requests, rows },
  onClose,
}: {
  eventId: string;
  requests: ApprovalRequests;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Account | null>(null);
  const { refetch } = requests;
  const send = useMutation((target: ApprovalRequestTarget) => requestApproval(eventId, target), {
    fallback: "Failed to send the approval request",
    onSuccess: () => {
      refetch();
      onClose();
    },
  });

  return (
    <ConfirmDialog
      title="Request approval"
      confirmLabel={selected ? `Ask ${accountName(selected)}` : "Ask for approval"}
      confirmAction="askApproval"
      busyLabel="Sending…"
      busy={send.loading}
      confirmDisabled={!selected}
      error={send.error ?? requests.error}
      onConfirm={() => selected && void send.run(targetOf(selected))}
      onCancel={onClose}
    >
      <section aria-label="Open requests">
        <h3 className={FORM_LABEL}>Open requests</h3>
        {rows.length > 0 ? (
          <div className="divide-y divide-neutral-800">
            {rows.map((request) => (
              <RequestRow key={request.id} request={request} />
            ))}
          </div>
        ) : (
          requests.data && <p className="py-2 text-sm text-neutral-500">No open requests.</p>
        )}
      </section>
      <div className="space-y-1.5">
        <label htmlFor={TARGET_FIELD_ID} className={FORM_LABEL}>
          Ask an analyst or an organization to approve this version
        </label>
        <ItemSearch
          id={TARGET_FIELD_ID}
          search={(query) => searchTargets(eventId, query)}
          browse={() => searchTargets(eventId, "")}
          toItem={accountItem}
          rowKey={accountKey}
          selected={selected}
          onPick={setSelected}
          onClear={() => {
            setSelected(null);
            send.reset();
          }}
          onQueryChange={send.reset}
          placeholder="Search analysts and organizations"
          emptyText="No analyst or organization to suggest. Suggestions are analysts who follow you and organizations whose org managers follow you. Type an exact username or slug to ask someone else."
        />
      </div>
    </ConfirmDialog>
  );
}

/**
 * **Request approval** in the event's actions row: an icon that opens the dialog holding the open
 * requests and the picker that asks an analyst or an organization to approve the live version.
 * The caller renders it for a reader who may send a request (`canRequestApproval`).
 */
export function RequestApprovalAction({
  event,
  requests,
}: {
  event: EventDetail;
  requests: ApprovalRequests;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip label="Request approval">
        <Button
          icon
          variant="ghost"
          aria-label="Request approval"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <ClipboardCheck size={14} />
        </Button>
      </Tooltip>
      {open && (
        <RequestApprovalDialog
          eventId={event.id}
          requests={requests}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

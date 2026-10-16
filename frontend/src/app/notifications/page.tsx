"use client";

import { useEffect, useRef } from "react";
import {
  ArrowRightLeft,
  AtSign,
  BadgeCheck,
  Building2,
  CircleCheck,
  ClipboardCheck,
  ClipboardX,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import { useUnreadNotifications } from "@/contexts/NotificationsContext";
import { useCursorList } from "@/hooks/useCursorList";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { formatDate } from "@/lib/format";
import {
  NOTIFICATION_KIND_COPY,
  describeNotification,
  markNotificationsRead,
  notificationsPath,
  type Notification,
  type NotificationKind,
} from "@/lib/notifications";
import { InviteAnswerButtons } from "@/components/event/GeolocatorCredit";
import { ApprovalRequestDecline } from "@/components/event/ApprovalRequestsSection";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkRow } from "@/components/ui/LinkRow";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  request_fulfilled: CircleCheck,
  new_follower: UserPlus,
  x_handle_request_approved: AtSign,
  x_handle_request_declined: AtSign,
  co_geolocator_invite: Users,
  co_geolocator_removed: UserMinus,
  ownership_transferred: ArrowRightLeft,
  organization_invite: Building2,
  organization_invite_accepted: UserCheck,
  organization_manager_inherited: ShieldCheck,
  re_approve_requested: RefreshCw,
  approval_received: BadgeCheck,
  approval_request_received: ClipboardCheck,
  approval_request_declined: ClipboardX,
  organization_approval_removed: Building2,
};

function NotificationRows({
  title,
  rows,
  onChanged,
}: {
  title: string;
  rows: Notification[];
  onChanged: () => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <SectionEyebrow title={title} />
      <div className="space-y-2">
        {rows.map((n) => {
          const { text, href } = describeNotification(n);
          return (
            <div key={n.id} className="space-y-2">
              {/* Decline sits beside the link, not in it: the row is one link. Approving
                  happens on the event page only, after reading the event. */}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <LinkRow
                    icon={KIND_ICON[n.kind]}
                    label={`${NOTIFICATION_KIND_COPY[n.kind].label} · ${formatDate(n.created_at)}`}
                    value={text}
                    href={href}
                    external={false}
                  />
                </div>
                {n.approval_request_id !== null && n.event && (
                  <ApprovalRequestDecline
                    eventId={n.event.id}
                    requestId={n.approval_request_id}
                    onAnswered={onChanged}
                  />
                )}
              </div>
              {n.invite_pending && n.event && (
                <InviteAnswerButtons eventId={n.event.id} onAnswered={onChanged} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The signed-in analyst's notifications, newest first. The unread rows the page shows are
 *  marked read, which clears the sidebar dot; they stay under New until the next visit. */
export default function NotificationsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const { refresh } = useUnreadNotifications();
  const { items, error, loading, loadingMore, hasMore, loadMore, reload } =
    useCursorList<Notification>(notificationsPath);

  // The unread rows loaded so far, as one key, so a later page marks its own rows. Each id is
  // sent once: a second page posts only its own rows.
  const shownUnread = items
    .filter((n) => n.read_at === null)
    .map((n) => n.id)
    .join(",");
  const marked = useRef(new Set<string>());
  useEffect(() => {
    const fresh = shownUnread ? shownUnread.split(",").filter((id) => !marked.current.has(id)) : [];
    if (fresh.length === 0) return;
    fresh.forEach((id) => marked.current.add(id));
    markNotificationsRead(fresh)
      .then(refresh)
      .catch(() => {});
  }, [shownUnread, refresh]);

  if (authLoading || !user) return <PageLoading />;

  return (
    <PageShell title="Notifications">
      {error && <div className={FORM_ERROR_BANNER}>{error}</div>}
      {loading ? (
        <p className="text-sm text-neutral-500">Loading notifications…</p>
      ) : items.length === 0 ? (
        <EmptyState>
          Nothing yet. A notification appears here when someone geolocates a request you
          opened, follows you, invites you to share the credit of a geolocation, or invites
          you to an organization.
        </EmptyState>
      ) : (
        <>
          <NotificationRows
            title="New"
            rows={items.filter((n) => n.read_at === null)}
            onChanged={reload}
          />
          <NotificationRows
            title="Earlier"
            rows={items.filter((n) => n.read_at !== null)}
            onChanged={reload}
          />
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

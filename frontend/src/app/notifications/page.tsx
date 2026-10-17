"use client";

import { useEffect, useRef } from "react";
import {
  ArrowRightLeft,
  AtSign,
  BadgeCheck,
  BadgeX,
  Building2,
  CircleCheck,
  ClipboardCheck,
  ClipboardX,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import { useUnreadNotifications } from "@/contexts/NotificationsContext";
import { useCursorList } from "@/hooks/useCursorList";
import { useMutation } from "@/hooks/useMutation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  deleteNotification,
  describeNotification,
  markNotificationsRead,
  notificationAvatar,
  notificationLabel,
  notificationsPath,
  type Notification,
  type NotificationKind,
} from "@/lib/notifications";
import { InviteAnswerButtons } from "@/components/event/GeolocatorCredit";
import { Avatar } from "@/components/ui/Avatar";
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
  approval_revoked: BadgeX,
  approval_request_received: ClipboardCheck,
  approval_request_declined: ClipboardX,
  organization_approval_removed: Building2,
};

function DeleteNotification({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const remove = useMutation(() => deleteNotification(id), {
    fallback: "Failed to delete the notification",
    onSuccess: onDeleted,
  });
  return (
    <>
      <Button
        icon
        variant="ghost"
        aria-label="Delete notification"
        title="Delete"
        onClick={() => void remove.run()}
        disabled={remove.loading}
      >
        <Trash2 size={14} />
      </Button>
      {remove.error && (
        <div className={`${FORM_ERROR_BANNER} basis-full`} role="alert">
          {remove.error}
        </div>
      )}
    </>
  );
}

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
          const avatar = notificationAvatar(n);
          return (
            <div key={n.id} className="space-y-2">
              {/* Decline sits below the link, not in it or beside it: the row is one link, and
                  beside it a phone would squeeze the title. Approving happens on the event page
                  only, after reading the event. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-0">
                  <LinkRow
                    icon={KIND_ICON[n.kind]}
                    leading={
                      avatar && (
                        // Decorative: the sentence beside it names the analyst or the organization.
                        <Avatar
                          src={avatar.avatarUrl}
                          username={avatar.name}
                          size="size-7"
                          shape={avatar.shape}
                          decorative
                        />
                      )
                    }
                    label={notificationLabel(n)}
                    value={text}
                    href={href}
                    external={false}
                  />
                </div>
                <DeleteNotification id={n.id} onDeleted={onChanged} />
              </div>
              {n.approval_request_id !== null && n.event && (
                <ApprovalRequestDecline
                  eventId={n.event.id}
                  requestId={n.approval_request_id}
                  onAnswered={onChanged}
                />
              )}
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

  const changed = () => {
    reload();
    refresh();
  };

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
            onChanged={changed}
          />
          <NotificationRows
            title="Earlier"
            rows={items.filter((n) => n.read_at !== null)}
            onChanged={changed}
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

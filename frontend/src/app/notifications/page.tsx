"use client";

import { useEffect } from "react";
import { CircleCheck, UserPlus, type LucideIcon } from "lucide-react";

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
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkRow } from "@/components/ui/LinkRow";
import { PageLoading, PageShell } from "@/components/ui/PageShell";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  request_fulfilled: CircleCheck,
  new_follower: UserPlus,
};

function NotificationRows({ title, rows }: { title: string; rows: Notification[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <SectionEyebrow title={title} />
      <div className="space-y-2">
        {rows.map((n) => {
          const { text, href } = describeNotification(n);
          return (
            <LinkRow
              key={n.id}
              icon={KIND_ICON[n.kind]}
              label={`${NOTIFICATION_KIND_COPY[n.kind].label} · ${formatDate(n.created_at)}`}
              value={text}
              href={href}
              external={false}
            />
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
  const { items, error, loading, loadingMore, hasMore, loadMore } =
    useCursorList<Notification>(notificationsPath);

  // The unread rows loaded so far, as one key, so a later page marks its own rows.
  const shownUnread = items
    .filter((n) => n.read_at === null)
    .map((n) => n.id)
    .join(",");
  useEffect(() => {
    if (!shownUnread) return;
    markNotificationsRead(shownUnread.split(","))
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
          opened or follows you.
        </EmptyState>
      ) : (
        <>
          <NotificationRows title="New" rows={items.filter((n) => n.read_at === null)} />
          <NotificationRows title="Earlier" rows={items.filter((n) => n.read_at !== null)} />
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

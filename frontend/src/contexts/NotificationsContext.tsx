"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { UNREAD_COUNT_PATH, type UnreadCount } from "@/lib/notifications";

interface NotificationsValue {
  /** Notifications newer than the last-read marker; 0 when logged out or none. */
  unread: number;
  /** Re-fetch after the feed advances the marker so the sidebar dot clears. */
  refresh: () => void;
}

const NotificationsContext = createContext<NotificationsValue>({
  unread: 0,
  refresh: () => {},
});

/** One shared unread count for the sidebar dot and the feed. Re-fetched on every navigation,
 *  so a notification written while the analyst browses shows on their next page. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const { data, refetch } = useApiResource<UnreadCount>(
    user ? UNREAD_COUNT_PATH : null
  );

  // The mount fetch is `useApiResource`'s own; this follows later navigations only.
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    refetch();
  }, [pathname, refetch]);

  return (
    <NotificationsContext.Provider
      value={{ unread: data?.count ?? 0, refresh: refetch }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useUnreadNotifications(): NotificationsValue {
  return useContext(NotificationsContext);
}

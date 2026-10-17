"use client";

import { AdminProvider } from "@/contexts/AdminContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { MapStateProvider } from "@/contexts/MapStateContext";
import { DetectionsProvider } from "@/contexts/DetectionsContext";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import PathTracker from "@/components/PathTracker";
import PreferencesSync from "@/components/PreferencesSync";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AdminProvider>
        <DetectionsProvider>
          <NotificationsProvider>
            <MapStateProvider>
              <PathTracker />
              <PreferencesSync />
              {children}
            </MapStateProvider>
          </NotificationsProvider>
        </DetectionsProvider>
      </AdminProvider>
    </AuthProvider>
  );
}

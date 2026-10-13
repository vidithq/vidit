"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { MapStateProvider } from "@/contexts/MapStateContext";
import { DetectionsProvider } from "@/contexts/DetectionsContext";
import PathTracker from "@/components/PathTracker";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DetectionsProvider>
        <MapStateProvider>
          <PathTracker />
          {children}
        </MapStateProvider>
      </DetectionsProvider>
    </AuthProvider>
  );
}

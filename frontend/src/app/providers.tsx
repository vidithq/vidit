"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { MapStateProvider } from "@/contexts/MapStateContext";
import { DetectionsProvider } from "@/contexts/DetectionsContext";
import { ReviewPassProvider } from "@/contexts/ReviewPassContext";
import PathTracker from "@/components/PathTracker";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DetectionsProvider>
        <ReviewPassProvider>
          <MapStateProvider>
            <PathTracker />
            {children}
          </MapStateProvider>
        </ReviewPassProvider>
      </DetectionsProvider>
    </AuthProvider>
  );
}

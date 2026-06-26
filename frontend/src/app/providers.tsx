"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { MapStateProvider } from "@/contexts/MapStateContext";
import { ReviewQueueProvider } from "@/contexts/ReviewQueueContext";
import PathTracker from "@/components/PathTracker";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ReviewQueueProvider>
        <MapStateProvider>
          <PathTracker />
          {children}
        </MapStateProvider>
      </ReviewQueueProvider>
    </AuthProvider>
  );
}

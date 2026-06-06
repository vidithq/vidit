"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { MapStateProvider } from "@/contexts/MapStateContext";
import PathTracker from "@/components/PathTracker";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <MapStateProvider>
        <PathTracker />
        {children}
      </MapStateProvider>
    </AuthProvider>
  );
}

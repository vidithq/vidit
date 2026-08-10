"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { buttonClasses } from "@/components/ui/Button";

// Hero CTA island that swaps on auth state (signed-in sees "Open the map").
// While auth resolves on a hard load of `/`, `user` is null and the signed-out
// CTA renders — the correct SSR default for the anonymous majority. Client nav
// from the sidebar already has AuthContext populated, so there's no flash.
export default function HeroCtas() {
  const { user } = useAuth();

  if (user) {
    return (
      <div className="mt-8 flex items-center justify-center">
        <Link href="/map" className={buttonClasses("primary")}>
          Open the map
          <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  // Anonymous visitors are readers first (not only analysts), so the hero
  // carries the read path alone; joining lives in the sidebar's sign-in.
  return (
    <div className="mt-8 flex items-center justify-center">
      <Link href="/map" className={buttonClasses("primary")}>
        Explore the map
        <ArrowRight size={15} />
      </Link>
    </div>
  );
}

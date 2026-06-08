"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PRIMARY_BUTTON } from "@/components/ui/styles";

// Hero call-to-action island for the landing page. Swaps on auth state so
// a signed-in analyst sees "Open the map" instead of the invite CTA they
// don't need. While auth is resolving on a hard load of `/`, `user` is null
// and the signed-out CTA renders — which is also the correct SSR default
// for the anonymous majority. On client-side nav from the sidebar the
// AuthContext is already populated, so there's no flash.
export default function HeroCtas() {
  const { user } = useAuth();

  if (user) {
    return (
      <div className="mt-8 flex items-center justify-center">
        <Link
          href="/map"
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
        >
          Open the map
          <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <Link
        href="/register"
        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
      >
        Have an invite code?
        <ArrowRight size={15} />
      </Link>
      <p className="text-sm text-neutral-400">
        No invite? Request access — DM{" "}
        <a
          href="https://x.com/vidithq"
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-400 hover:text-orange-300"
        >
          @vidithq
        </a>{" "}
        or ask in{" "}
        <a
          href="https://discord.gg/9wPtsrrKyJ"
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-400 hover:text-orange-300"
        >
          Discord
        </a>
        .
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { buttonClasses } from "@/components/ui/Button";
import { TEXT_LINK } from "@/components/ui/styles";

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

  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <Link href="/register" className={buttonClasses("primary")}>
        Have an invite code?
        <ArrowRight size={15} />
      </Link>
      <p className="text-sm text-neutral-400">
        No invite? Request access — DM{" "}
        <a
          href="https://x.com/vidithq"
          target="_blank"
          rel="noopener noreferrer"
          className={TEXT_LINK}
        >
          @vidithq
        </a>{" "}
        or ask in{" "}
        <a
          href="https://discord.gg/9wPtsrrKyJ"
          target="_blank"
          rel="noopener noreferrer"
          className={TEXT_LINK}
        >
          Discord
        </a>
        .
      </p>
    </div>
  );
}

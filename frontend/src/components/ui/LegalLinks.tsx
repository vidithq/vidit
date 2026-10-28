import Link from "next/link";

import { cn } from "@/lib/cn";
import { TEXT_LINK } from "./styles";

/** The legal notice and the privacy policy must be reachable before an account exists. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] text-neutral-600", className)}>
      <Link href="/legal" className={TEXT_LINK}>
        Legal notice
      </Link>
      {" · "}
      <Link href="/privacy" className={TEXT_LINK}>
        Privacy policy
      </Link>
    </p>
  );
}

import Link from "next/link";

import { PageCenter } from "@/components/ui/PageFrame";
import { TEXT_LINK } from "@/components/ui/styles";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main>
      <PageCenter className="px-4 bg-neutral-950">
        {/* The legal notice and privacy policy must be reachable before an account exists. */}
        <div className="flex flex-col items-center gap-4">
          {children}
          <p className="text-[11px] text-neutral-600">
            <Link href="/legal" className={TEXT_LINK}>
              Legal notice
            </Link>
            {" · "}
            <Link href="/privacy" className={TEXT_LINK}>
              Privacy policy
            </Link>
          </p>
        </div>
      </PageCenter>
    </main>
  );
}

import Link from "next/link";

import { TEXT_LINK } from "@/components/ui/styles";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen pl-14 flex items-center justify-center px-4 bg-neutral-950">
      {/* The auth card plus the one discreet line under it. The legal notice
          and the privacy policy have to be reachable before an account exists,
          and the sign-in screen is where a visitor without one lands. */}
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
    </main>
  );
}

"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { smartBack } from "@/lib/navigation";

export function PageShell({
  title,
  subtitle,
  back = false,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const handleBack = () => smartBack(router);
  return (
    <div className="min-h-screen pl-14">
      <div className="max-w-4xl mx-auto px-6 pt-10 pb-16 space-y-6">
        <header className="relative">
          {back && (
            // Anchored to the left edge of the header — `right-full` puts the
            // button's right side flush with the header's left side, `mr-3`
            // adds a 12px gap. The header is `relative` so this absolute
            // positioning is local. Means the title and subtitle sit at the
            // same column-edge x-coordinate whether the back arrow is shown
            // or not.
            <button
              type="button"
              onClick={handleBack}
              aria-label="Back"
              className="absolute right-full top-1.5 mr-3 text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-xl font-medium text-neutral-100">{title}</h1>
              {subtitle && (
                <div className="text-sm text-neutral-400">{subtitle}</div>
              )}
            </div>
            {actions && <div className="shrink-0">{actions}</div>}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

// Centered loading / error / empty state — used by every page's
// pre-data branches. Sibling to PageShell so the sidebar offset (`pl-14`)
// stays in one place.
export function PageCenter({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center pl-14">
      {children}
    </div>
  );
}

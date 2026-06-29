"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { smartBack } from "@/lib/navigation";
import { PageFrame } from "./PageFrame";

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
    <PageFrame className="pt-10 pb-16 space-y-6">
      <header className="relative">
        {back && (
          // `right-full` parks the button outside the header's left edge
          // (header is `relative`), so the title's x-coordinate is the same
          // whether or not the back arrow renders.
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
    </PageFrame>
  );
}

// Centered loading / error / empty state. Sibling to PageShell so the sidebar
// offset (`pl-14`) stays in one place.
export function PageCenter({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center pl-14">
      {children}
    </div>
  );
}

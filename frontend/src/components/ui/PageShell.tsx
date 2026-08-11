"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { smartBack } from "@/lib/navigation";
import { TEXT_LINK } from "./styles";
import { Button } from "./Button";
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
          <Button
            icon
            variant="ghost"
            onClick={handleBack}
            aria-label="Back"
            className="absolute right-full top-1.5 mr-3"
          >
            <ArrowLeft size={18} />
          </Button>
        )}
        {/* The action cluster drops under the title once the two can't share a
            row (a phone-width viewport with a long title): `basis-56` is the
            14rem the title asks for, which is what flex wrapping measures, so
            a heading is never squeezed into a one-word column. It is a
            preference and not a floor (`min-w-0`, `grow` rather than `flex-1`
            so the basis survives): as a hard minimum it outgrew the frame on
            the narrowest phones and scrolled the whole page sideways. */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="basis-56 grow min-w-0 space-y-2">
            <h1 className="text-xl font-medium text-neutral-100">{title}</h1>
            {subtitle && (
              // The owner's email is one unbreakable token; without an
              // anywhere-break it runs past the frame on a phone.
              <div className="text-sm text-neutral-400 break-words [overflow-wrap:anywhere]">
                {subtitle}
              </div>
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
// offset (`pl-14`) stays in one place. Internal: pages reach it through
// PageLoading / PageError, never directly.
function PageCenter({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center pl-14">
      {children}
    </div>
  );
}

// Centered pre-data loading state. One home for the muted "Loading…" the pages
// showed via copy-pasted spans (which had drifted between `...` and `…`).
export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <PageCenter>
      <span className="text-neutral-500">{label}</span>
    </PageCenter>
  );
}

// Centered error state, optionally with a back link. Covers both the bare
// message and the "message + Back to map" variant the pages hand-rolled.
export function PageError({
  message,
  backHref,
}: {
  message: ReactNode;
  backHref?: string;
}) {
  return (
    <PageCenter>
      <div className="text-center space-y-2">
        <p className="text-sm text-neutral-300">{message}</p>
        {backHref && (
          <Link href={backHref} className={`text-xs ${TEXT_LINK}`}>
            Back to map
          </Link>
        )}
      </div>
    </PageCenter>
  );
}

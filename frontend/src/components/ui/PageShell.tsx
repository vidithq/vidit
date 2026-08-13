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
  backFallback,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: boolean;
  /** Where Back lands when the session carries nothing to return to, i.e. the
   *  reader arrived straight from a search result. Forwards to `smartBack`'s
   *  own `fallback`, which stays `/` when this is unset. The public guides pass
   *  their hub, so a cold entry still has somewhere to go. */
  backFallback?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const handleBack = () => smartBack(router, backFallback);
  return (
    <PageFrame className="pt-10 pb-16 space-y-6">
      <header className="relative">
        {back && (
          // `right-full` parks the button outside the header's left edge
          // (header is `relative`), so the title's x-coordinate is the same
          // whether or not the back arrow renders. That gutter only exists once
          // the centred column has room to sit off the rail, which is from `lg`
          // up: below it the button landed under the fixed sidebar, where taps
          // reached the nav rather than the button. Below `lg` it sits in flow
          // above the title, and `flex` says so: the row above the heading is
          // the intended layout, not an inline atom that happens to break
          // before its block sibling (`size-9` fixes the width, so a block-level
          // flex box can't stretch the square). `-ml-2` pulls it back toward the
          // heading: the 36px square insets its 18px glyph by 9px, and the class
          // takes 8 of those back.
          <Button
            icon
            variant="ghost"
            onClick={handleBack}
            aria-label="Back"
            className="flex -ml-2 mb-1 lg:inline-flex lg:absolute lg:right-full lg:top-1.5 lg:mr-3 lg:mb-0 lg:ml-0"
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
          {/* `max-w-full` caps the cluster at the header width, which is what
              lets a wide row (the request page's four action buttons plus the
              share and report controls) wrap inside itself. Without it,
              `shrink-0` holds the cluster at its max-content width and a phone
              scrolls sideways. The cap only binds once the cluster has taken
              its own line, so a cluster that fits beside the title is
              untouched. */}
          {actions && <div className="shrink-0 max-w-full">{actions}</div>}
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

// Centered pre-data loading state. One home for the muted "Loading…".
export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <PageCenter>
      <span className="text-neutral-500">{label}</span>
    </PageCenter>
  );
}

// Centered error state, optionally with a back link. Covers both the bare
// message and the "message + Back to map" variant.
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

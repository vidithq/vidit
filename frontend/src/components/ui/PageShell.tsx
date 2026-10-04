"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { smartBack } from "@/lib/navigation";
import { getPhoneBackSlot, subscribePhoneBackSlot } from "@/lib/phoneBackSlot";
import { TEXT_LINK } from "./styles";
import { Button } from "./Button";
import { PageCenter, PageFrame } from "./PageFrame";

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
  /** Where Back lands when the session has nothing to return to. Forwards to
   *  `smartBack`'s `fallback` (`/` when unset). */
  backFallback?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const handleBack = () => smartBack(router, backFallback);
  // The chip's back slot, published by `Sidebar`. Null until the chip exists.
  const phoneBackSlot = useSyncExternalStore(
    subscribePhoneBackSlot,
    getPhoneBackSlot,
    getPhoneBackSlot,
  );
  // One control, two placements: only the visibility classes differ.
  const renderBack = (className: string) => (
    <Button
      icon
      variant="ghost"
      onClick={handleBack}
      aria-label="Back"
      title="Back"
      className={className}
    >
      <ArrowLeft size={18} />
    </Button>
  );
  return (
    // `max-sm:pt-16` (64px) clears the off-canvas rail's chip (about 55px).
    <PageFrame className="pt-10 max-sm:pt-16 pb-16 space-y-6">
      <header className="relative">
        {back && (
          // `right-full` parks the button outside the header's left edge, so the
          // title's x is the same with or without it. That gutter exists from
          // `lg` up; below it the button would sit under the fixed sidebar. From
          // `sm` to `lg` it sits in flow above the title (`flex`, since `size-9`
          // fixes the width). `-ml-2` takes back 8 of the glyph's 9px inset.
          // Below `sm` the chip copy takes over.
          renderBack(
            "max-sm:hidden flex -ml-2 mb-1 lg:inline-flex lg:absolute lg:right-full lg:top-1.5 lg:mr-3 lg:mb-0 lg:ml-0",
          )
        )}
        {/* Phone only: portaled into the chip's back slot, which lives inside a
            `sm:hidden` chip. */}
        {back && phoneBackSlot && createPortal(renderBack(""), phoneBackSlot)}
        {/* The actions drop under the title once they can't share a row. `basis-56`
            (14rem) is a preference, not a floor (`min-w-0`, `grow`): as a hard
            minimum it scrolled the page sideways on the narrowest phones. */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="basis-56 grow min-w-0 space-y-2">
            <h1 className="text-xl font-medium text-neutral-100">{title}</h1>
            {subtitle && (
              // The owner's email is one unbreakable token.
              <div className="text-sm text-neutral-400 wrap-anywhere">
                {subtitle}
              </div>
            )}
          </div>
          {/* `max-w-full` lets a wide action row wrap inside itself; `shrink-0` alone
              would scroll a phone sideways. */}
          {actions && <div className="shrink-0 max-w-full">{actions}</div>}
        </div>
      </header>
      {children}
    </PageFrame>
  );
}

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <PageCenter>
      <span className="text-neutral-500">{label}</span>
    </PageCenter>
  );
}

// Centered error state, with an optional back link.
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

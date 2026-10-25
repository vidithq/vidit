"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { FLOATING_CONTROL } from "@/components/ui/styles";
import { cn } from "@/lib/cn";

// `[tabindex]` carries the media-chrome controls: each custom element puts the
// tabstop on its own host.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The overlay shell: backdrop closing on click or Escape, content clicks
 * stopped, controls in one row at the content's top-right corner.
 *
 * **Escape** belongs to fullscreen first: the browser exits a player's
 * fullscreen on Escape itself, and handling it here too would close both layers
 * at once.
 *
 * **Focus** moves to the close button on mount, stays inside while open (Tab
 * wraps) and returns to the previous element on unmount. Hand-rolled: one
 * dialog with one exit.
 *
 * **Variant.** `media` dims to near black under the corner controls, so pixels
 * read at full contrast. `dialog` dims and blurs the page in the theme's own
 * canvas and draws no corner controls: the content carries its own exit,
 * marked `data-overlay-close` so focus lands on it.
 *
 * **Layer.** Portalled to `document.body` at a z-index above every floating
 * surface (map panels 1000, sidebar 1100, banner 1200). `fixed` resolves
 * against a transformed ancestor (a proof body, the map's detail panel), so
 * portalling is what lets the overlay cover the screen from every caller.
 */
export function MediaOverlay({
  label,
  actions,
  onClose,
  variant = "media",
  children,
}: {
  /** Accessible name for the dialog. */
  label: string;
  variant?: "media" | "dialog";
  /** Extra corner controls, rendered left of the close button. */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Fullscreen owns this press; the browser is already exiting it.
        if (document.fullscreenElement) return;
        // A control inside took this press: an open combobox list closes alone.
        if (e.defaultPrevented) return;
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const stops = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      );
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      // Focus inside a shadow root reports as its host, which is in the list.
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[data-overlay-close]")?.focus();
    // The opener can be gone by then: best-effort.
    return () => restoreTo?.focus?.();
  }, []);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={cn(
        "fixed inset-0 z-1500 safe-pt safe-pr safe-pb safe-pl",
        variant === "media" ? "bg-black/85" : "bg-neutral-950/60 backdrop-blur-sm",
      )}
      onClick={onClose}
    >
      {/* The backdrop fills the screen with the safe-area insets as padding, so a
          tap in the cutout or home-indicator band closes the viewer. The centring
          frame is a child because its `p-6` and the inset padding set the same
          property. */}
      {/* `items-start` plus `my-auto`, not `items-center`: auto margins collapse
          to 0 when the content overflows, while a centred overflowing item
          leaves a band above scroll origin that no gesture reaches (where the
          close cluster hangs). The child is sized by its content, so a tall
          frame scrolls instead of being cut. */}
      <div className="flex h-full w-full items-start justify-center overflow-y-auto p-6">
        <div
          className="relative my-auto max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
          {variant === "media" && (
            <div className="absolute -top-3 -right-3 z-10 flex items-center gap-1">
              {actions}
              <Button
                icon
                variant="ghost"
                className={FLOATING_CONTROL}
                aria-label="Close"
                title="Close"
                data-overlay-close=""
                onClick={onClose}
              >
                <X size={16} />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

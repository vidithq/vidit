"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional one-line description under the title. */
  subtitle?: ReactNode;
  children: ReactNode;
}

/**
 * Minimal centered dialog: opaque card over a dimmed backdrop, dismissed by the
 * × button, Escape, or a backdrop click. `z-2000` clears the sidebar (`z-1100`)
 * and the map's detail panel (`z-1000`). Not a focus-trap — enough for the
 * single-input flows it hosts (tweet import).
 */
export function Modal({ open, onClose, title, subtitle, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-2000 flex items-start justify-center bg-black/60 p-4 pt-24"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-800 px-5 py-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
            {subtitle && <p className="text-xs text-neutral-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

"use client";

import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "./Button";

/**
 * A ghost toggle that shows or hides a block of secondary fields under it. The parent owns
 * `open`, so it can open the block itself (a value to show, a flagged field inside).
 *
 * The block stays mounted while closed (`hidden`), so a field inside keeps what it holds.
 */
export function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-4">
      <Button variant="ghost" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <ChevronRight size={14} className={cn("transition-transform", open && "rotate-90")} />
        {label}
      </Button>
      <div id={id} hidden={!open} className="space-y-4">
        {children}
      </div>
    </div>
  );
}

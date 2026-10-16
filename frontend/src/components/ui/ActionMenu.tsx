"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";

import { cn } from "@/lib/cn";
import { Button, buttonClasses } from "./Button";
import { ACCENT_SURFACE, TOOLTIP_SURFACE } from "./styles";

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Navigates instead of acting. */
  href?: string;
  onSelect?: () => void;
  tone?: "accent" | "danger";
  /** The item's panel is open: the item wears the active-row paint and says so. */
  active?: boolean;
  /** A link to the page on screen (`aria-current`), which the menu focuses when it opens. */
  current?: boolean;
  /** A muted word after the label, such as *Current*. */
  meta?: string;
}

const ITEM =
  "flex w-full min-h-9 items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs font-medium outline-none transition-colors";
const ITEM_TONE = {
  accent: "text-orange-400 hover:bg-orange-500/10 focus-visible:bg-orange-500/10",
  danger: "text-red-400 hover:bg-red-500/10 focus-visible:bg-red-500/10",
} as const;
// The menu keeps this much room from either viewport edge.
const EDGE_PX = 8;

function itemNodes(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

/**
 * A trigger button that opens a short list of actions (`role="menu"`). Arrow keys, Home and End
 * move between items; Escape closes and returns focus to the trigger; Tab or an outside click
 * closes. The menu opens under the trigger, aligned to its right edge, and shifts sideways when
 * that would cross the viewport. A long list scrolls inside the menu. A menu of one item renders
 * that item as its own icon control instead (the item's icon, tone, name and open state).
 */
export function ActionMenu({
  label,
  icon,
  text,
  menuLabel = label,
  items,
  note,
}: {
  /** The trigger's accessible name and tooltip. With `text`, it starts with that text. */
  label: string;
  icon: ReactNode;
  /** Printed on the trigger before the icon (the version selector's *v2*); icon-only when unset. */
  text?: string;
  /** The list's accessible name; the trigger's when unset. */
  menuLabel?: string;
  items: ActionMenuItem[];
  /** A line above the items, read before acting on any of them. */
  note?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const openAt = (edge: "first" | "last") => {
    focusOnOpen.current = edge;
    setOpen(true);
  };

  // Placed before paint: a style write, not state, so the menu never renders at the wrong edge.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    const { left, width } = menu.getBoundingClientRect();
    const room = document.documentElement.clientWidth - EDGE_PX - width;
    const shift = Math.max(EDGE_PX, Math.min(left, room)) - left;
    if (shift !== 0) menu.style.right = `${-shift}px`;
    const nodes = itemNodes(menu);
    const current = nodes.find((node) => node.hasAttribute("aria-current"));
    (focusOnOpen.current === "last" ? nodes[nodes.length - 1] : (current ?? nodes[0]))?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openAt(e.key === "ArrowDown" ? "first" : "last");
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const nodes = itemNodes(e.currentTarget);
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      e.preventDefault();
      nodes[(index + nodes.length) % nodes.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        return move(at + 1);
      case "ArrowUp":
        return move(at - 1);
      case "Home":
        return move(0);
      case "End":
        return move(nodes.length - 1);
      case "Escape":
        e.preventDefault();
        return close(true);
      case "Tab":
        return close(false);
      case " ":
        // A link answers Enter only; Space activates every item.
        if (at >= 0) {
          e.preventDefault();
          nodes[at].click();
        }
    }
  };

  // A menu of one item is that item: its own icon control, one click instead of two.
  if (items.length === 1 && !text) {
    const [item] = items;
    const variant = item.tone === "danger" ? "dangerGhost" : "ghost";
    const shown = item.icon ?? item.label;
    return item.href ? (
      <Link
        href={item.href}
        aria-label={item.label}
        title={item.label}
        aria-current={item.current ? "page" : undefined}
        className={buttonClasses(variant, { icon: !!item.icon })}
      >
        {shown}
      </Link>
    ) : (
      <Button
        icon={!!item.icon}
        variant={variant}
        aria-label={item.label}
        title={item.label}
        aria-expanded={item.active}
        onClick={item.onSelect}
        className={item.active ? ACCENT_SURFACE : ""}
      >
        {shown}
      </Button>
    );
  }

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <Button
        ref={triggerRef}
        icon={!text}
        variant="ghost"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt("first"))}
        onKeyDown={onTriggerKeyDown}
        className={open ? ACCENT_SURFACE : ""}
      >
        {text}
        {icon}
      </Button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute right-0 top-full z-50 mt-1 max-h-80 w-56 max-w-[calc(100vw-2rem)] space-y-0.5 overflow-y-auto rounded-md p-1",
            TOOLTIP_SURFACE,
          )}
        >
          {note && <p className="px-2.5 py-1.5 text-[11px] text-neutral-400">{note}</p>}
          {items.map((item) => {
            const className = cn(
              ITEM,
              ITEM_TONE[item.tone ?? "accent"],
              (item.active || item.current) && ACCENT_SURFACE,
            );
            const content = (
              <>
                {item.icon}
                {item.label}
                {/* The space keeps the accessible name two words ("Version 3 Current"). */}
                {item.meta && " "}
                {item.meta && (
                  <span className="ml-auto text-[11px] font-normal text-neutral-500">
                    {item.meta}
                  </span>
                )}
              </>
            );
            return item.href ? (
              <Link
                key={item.key}
                href={item.href}
                role="menuitem"
                tabIndex={-1}
                aria-current={item.current ? "page" : undefined}
                className={className}
                onClick={() => close(false)}
              >
                {content}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-expanded={item.active}
                className={className}
                onClick={() => {
                  close(true);
                  item.onSelect?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
import { createPortal } from "react-dom";
import Link from "next/link";

import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { ACCENT_SURFACE, TOOLTIP_SURFACE } from "./styles";

export type ActionMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** The link to the page on screen (`aria-current`), which the menu focuses when it opens. */
  current?: boolean;
  /** Shows the icon alone, with `label` as the accessible name and a tooltip, for a list too
   *  narrow to print it. */
  iconOnly?: boolean;
} & (
  | { href: string; onSelect?: never }
  /** An action instead of a link (the edit page's close, which opens a dialog). The menu closes
   *  and gives focus back to the trigger first. */
  | { onSelect: () => void; href?: never }
);

const ITEM =
  "flex w-full min-h-9 items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs font-medium outline-none transition-colors text-orange-400 hover:bg-orange-500/10 focus-visible:bg-orange-500/10";
// The menu keeps this much room from either viewport edge.
const EDGE_PX = 8;
// Between the trigger's bottom edge and the menu.
const GAP_PX = 4;

function itemNodes(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

/**
 * A trigger button that opens a short list of links or actions (`role="menu"`). Arrow keys, Home and End
 * move between items; Escape closes and returns focus to the trigger; Tab or an outside click
 * closes. The menu opens under the trigger, aligned to its right edge, and shifts sideways when
 * that would cross the viewport; with `matchTriggerWidth` it is exactly as wide as the trigger. A
 * long list scrolls inside the menu. It is fixed to the viewport from a portal, so a scrolling
 * ancestor (the admin invite table) cannot clip it, and it follows the trigger on scroll.
 */
export function ActionMenu({
  label,
  icon,
  text,
  menuLabel = label,
  items,
  matchTriggerWidth = false,
}: {
  /** The trigger's accessible name and tooltip. With `text`, it starts with that text. */
  label: string;
  icon: ReactNode;
  /** Printed on the trigger before the icon (the version selector's *v2*); icon-only when unset. */
  text?: string;
  /** The list's accessible name; the trigger's when unset. */
  menuLabel?: string;
  items: ActionMenuItem[];
  /** Spans the list over the trigger's width, for a compact picker. */
  matchTriggerWidth?: boolean;
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

  // Placed before paint and again on every scroll or resize: style writes, not state, so the menu
  // never renders at the wrong spot.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !menu || !trigger) return;
    const place = () => {
      const anchor = trigger.getBoundingClientRect();
      const width = matchTriggerWidth ? anchor.width : menu.getBoundingClientRect().width;
      const room = document.documentElement.clientWidth - EDGE_PX - width;
      const left = matchTriggerWidth
        ? anchor.left
        : Math.max(EDGE_PX, Math.min(anchor.right - width, room));
      menu.style.top = `${anchor.bottom + GAP_PX}px`;
      menu.style.left = `${left}px`;
      if (matchTriggerWidth) menu.style.width = `${width}px`;
    };
    place();
    const nodes = itemNodes(menu);
    const current = nodes.find((node) => node.hasAttribute("aria-current"));
    (focusOnOpen.current === "last" ? nodes[nodes.length - 1] : (current ?? nodes[0]))?.focus();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, matchTriggerWidth]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrapperRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
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
        // From the trigger, so the Tab moves on from where the menu was opened, not from the
        // portal at the end of the page.
        return close(true);
      case " ":
        // A link answers Enter only; Space activates it too.
        if (at >= 0) {
          e.preventDefault();
          nodes[at].click();
        }
    }
  };

  return (
    <div ref={wrapperRef} className="inline-flex">
      <Button
        ref={triggerRef}
        icon={!text}
        variant="ghost"
        aria-label={label}
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
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={menuLabel}
            onKeyDown={onMenuKeyDown}
            className={cn(
              "fixed z-50 max-h-80 space-y-0.5 overflow-y-auto rounded-md p-1",
              !matchTriggerWidth && "w-56 max-w-[calc(100vw-2rem)]",
              TOOLTIP_SURFACE,
            )}
          >
            {items.map((item) => {
              const shared = {
                role: "menuitem",
                tabIndex: -1,
                "aria-current": item.current ? ("page" as const) : undefined,
                "aria-label": item.iconOnly ? item.label : undefined,
                className: cn(ITEM, item.iconOnly && "justify-center", item.current && ACCENT_SURFACE),
              };
              const content = (
                <>
                  {item.icon}
                  {!item.iconOnly && item.label}
                </>
              );
              const link =
                item.href !== undefined ? (
                  <Link key={item.key} href={item.href} {...shared} onClick={() => close(false)}>
                    {content}
                  </Link>
                ) : (
                  <button
                    key={item.key}
                    type="button"
                    {...shared}
                    onClick={() => {
                      close(true);
                      item.onSelect();
                    }}
                  >
                    {content}
                  </button>
                );
              return item.iconOnly ? (
                <Tooltip key={item.key} label={item.label}>
                  {link}
                </Tooltip>
              ) : (
                link
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

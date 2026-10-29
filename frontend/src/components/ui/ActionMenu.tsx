"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

import { useAnchoredPosition } from "@/hooks/useAnchoredPosition";
import { useDismiss } from "@/hooks/useDismiss";
import { cn } from "@/lib/cn";
import { Button, type ButtonAction } from "./Button";
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

function itemNodes(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

/**
 * A trigger button that opens a short list of links or actions (`role="menu"`). Arrow keys, Home and End
 * move between items; Escape closes and returns focus to the trigger; Tab or an outside click
 * closes. `useAnchoredPosition` places the menu under the trigger, or above it when the room below
 * is short, aligned to its right edge; with `matchTriggerWidth` it is exactly as wide as the
 * trigger. A long list scrolls inside the menu. It is fixed to the viewport from a portal, so a
 * scrolling ancestor (the admin invite table) cannot clip it.
 */
export function ActionMenu({
  label,
  icon,
  text,
  action,
  menuLabel = label,
  items,
  matchTriggerWidth = false,
  variant = "ghost",
  disabled = false,
}: {
  /** The trigger's accessible name and tooltip. With `text`, it starts with that text. */
  label: string;
  icon: ReactNode;
  /** Printed on the trigger before the icon (the version selector's *v2*); icon-only when unset. */
  text?: string;
  /** The action `text` names, whose icon leads it (**Approve**). A picker's text names none. */
  action?: ButtonAction;
  /** The list's accessible name; the trigger's when unset. */
  menuLabel?: string;
  items: ActionMenuItem[];
  /** Spans the list over the trigger's width, for a compact picker. */
  matchTriggerWidth?: boolean;
  /** The trigger's `<Button>` variant: `primary` when the menu is the page's main action (the
   *  event page's **Approve** with several identities). */
  variant?: "ghost" | "primary";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
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

  const position = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    floatingRef: menuRef,
    align: "end",
    matchWidth: matchTriggerWidth,
  });
  useDismiss({ open, anchorRef: triggerRef, floatingRef: menuRef, onDismiss: close });

  // Once placed, so focusing an item never scrolls toward a menu still at its unplaced spot.
  const placed = position !== undefined;
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!placed || !menu) return;
    const nodes = itemNodes(menu);
    const current = nodes.find((node) => node.hasAttribute("aria-current"));
    (focusOnOpen.current === "last" ? nodes[nodes.length - 1] : (current ?? nodes[0]))?.focus();
  }, [placed]);

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
    <div className="inline-flex">
      <Button
        ref={triggerRef}
        icon={!text}
        action={action}
        variant={variant}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt("first"))}
        onKeyDown={onTriggerKeyDown}
        // A text trigger stands as tall as the icon buttons of its row.
        className={cn(text && "sm:h-8", open && ACCENT_SURFACE)}
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
            style={position}
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

"use client";

import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";

import { usePinnedPopover } from "@/hooks/usePinnedPopover";
import { Button } from "./Button";
import { cn } from "@/lib/cn";

/**
 * The one overflow menu: a ghost `⋯` icon button that opens a small anchored
 * panel of actions. It holds the controls that act on the thing a surface is
 * about but do not deserve a permanent button, so an action row keeps at most
 * one flow action plus its utilities and everything else collapses behind one
 * trigger (see `docs/design.md` → *Page chrome*).
 *
 * The anchoring, the portal, and the dismissal (outside-click, Escape, scroll,
 * resize) are `usePinnedPopover`, the same machinery `FieldHelp` runs on, so
 * an `overflow` ancestor can never clip the panel. A menu takes the hook's
 * click toggle only and leaves the hover / focus opening behind: a control that
 * fires a delete must not open under a passing pointer.
 *
 * Semantics: the trigger carries `aria-haspopup="menu"` plus `aria-expanded`,
 * the panel is a `role="menu"`, and every entry is a real `<button>` or
 * `<Link>` with `role="menuitem"`. Acting on an entry closes the menu, so a
 * panel an entry opens is read against a closed menu.
 */

export interface OverflowMenuItem {
  /** The entry's visible text, and its accessible name. */
  label: string;
  /** Runs on click, then the menu closes. Omit on an `href` entry. */
  onClick?: () => void;
  /** Renders the entry as an in-app link instead of a button. */
  href?: string;
  /** Red text, for a destructive entry (delete, revoke). */
  danger?: boolean;
  disabled?: boolean;
  /** Ties the entry to the panel it opens, which is not a DOM sibling. */
  controls?: string;
  /** Leading glyph, sized like the rest of the icon set (14px). */
  icon?: ReactNode;
}

const ENTRY =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium transition-colors";

export function OverflowMenu({
  items,
  label = "More actions",
}: {
  items: OverflowMenuItem[];
  /** The trigger's accessible name, and the panel's. */
  label?: string;
}) {
  const { open, close, wrapperProps, anchorProps, popoverProps } =
    usePinnedPopover({ hover: false });
  const menuId = useId();

  // An empty menu has no trigger: a `⋯` that opens nothing is a dead control.
  if (items.length === 0) return null;

  const entryClass = (item: OverflowMenuItem) =>
    cn(
      ENTRY,
      item.danger
        ? "text-red-400 hover:bg-red-500/10"
        : "text-neutral-200 hover:bg-neutral-700",
      item.disabled && "opacity-50 pointer-events-none"
    );

  return (
    <span {...wrapperProps} className="inline-flex items-center">
      <Button
        {...anchorProps}
        icon
        variant="ghost"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <MoreHorizontal size={16} />
      </Button>
      {open &&
        createPortal(
          <span
            {...popoverProps}
            role="menu"
            id={menuId}
            aria-label={label}
            className="z-[2000] block min-w-44 py-1 rounded-md bg-neutral-800 border border-neutral-700 shadow-lg"
          >
            {items.map((item) =>
              item.href ? (
                <Link
                  key={item.label}
                  role="menuitem"
                  href={item.href}
                  aria-controls={item.controls}
                  className={entryClass(item)}
                  onClick={close}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  aria-controls={item.controls}
                  disabled={item.disabled}
                  className={entryClass(item)}
                  onClick={() => {
                    close();
                    item.onClick?.();
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              )
            )}
          </span>,
          document.body
        )}
    </span>
  );
}

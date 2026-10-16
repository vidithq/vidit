"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

import { usePinnedPopover } from "@/hooks/usePinnedPopover";
import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";
import { TOOLTIP_SURFACE } from "./styles";

export interface AvatarStackItem {
  key: string;
  name: string;
  avatarUrl?: string | null;
  /** An organization takes the rounded square, an analyst the circle. */
  variant: "analyst" | "organization";
  /** The picture's accessible name; `name` when unset. */
  label?: string;
  /** The picture's own page: the picture links there, and its card is a tooltip without controls. */
  href?: string;
  /** The card the picture opens, which holds the way on (a link to the profile). */
  renderCard: () => ReactNode;
}

const SIZE = "size-7 text-[11px]";
// The page canvas as a ring, so overlapping pictures read as separate discs.
const RING = "ring-2 ring-neutral-950 outline-hidden focus-visible:ring-orange-400";
const TABBABLE = "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** The next tabbable element after `from` in document order, skipping `within`. */
function tabbableAfter(from: HTMLElement, within: HTMLElement): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => !within.contains(el),
  );
  return all[all.indexOf(from) + 1] ?? null;
}

function Picture({ item }: { item: AvatarStackItem }) {
  return (
    <Avatar
      as="span"
      src={item.avatarUrl}
      username={item.name}
      size={SIZE}
      shape={item.variant === "organization" ? "square" : "circle"}
      decorative
    />
  );
}

const anchorClass = (item: AvatarStackItem) =>
  cn("flex", item.variant === "organization" ? "rounded-md" : "rounded-full", RING);

/** A picture that navigates: hover or focus shows its card as a tooltip, a click follows the link. */
function LinkedAvatar({ item, href }: { item: AvatarStackItem; href: string }) {
  const { open, wrapperProps, anchorProps, popoverProps } = usePinnedPopover<
    HTMLSpanElement,
    HTMLAnchorElement
  >();
  const tipId = useId();
  return (
    <span {...wrapperProps} className="relative flex hover:z-20 focus-within:z-20">
      <Link
        {...anchorProps}
        onClick={undefined}
        href={href}
        aria-label={item.label ?? item.name}
        aria-describedby={open ? tipId : undefined}
        className={anchorClass(item)}
      >
        <Picture item={item} />
      </Link>
      {open &&
        createPortal(
          <span
            {...popoverProps}
            role="tooltip"
            id={tipId}
            className={`z-[2000] w-max max-w-xs rounded-md px-3 py-2 text-xs ${TOOLTIP_SURFACE}`}
          >
            {item.renderCard()}
          </span>,
          document.body,
        )}
    </span>
  );
}

function StackedAvatar({ item }: { item: AvatarStackItem }) {
  const { open, pinned, close, wrapperProps, anchorProps, popoverProps } =
    usePinnedPopover<HTMLDivElement>();
  const cardId = useId();
  const { ref: anchorRef } = anchorProps;
  const { ref: cardRef } = popoverProps;
  // The card is portalled to the end of the body, out of the tab order: this tracks whether focus
  // is in it, so the card holds while it is and focus comes back to the picture when it closes.
  const focusInside = useRef(false);

  // A click pins the card and moves focus into it, so the keyboard reaches its link.
  useEffect(() => {
    if (pinned) {
      cardRef.current?.querySelector<HTMLElement>(TABBABLE)?.focus({ preventScroll: true });
    }
  }, [pinned, cardRef]);

  useEffect(() => {
    if (!open && focusInside.current) {
      focusInside.current = false;
      if (document.activeElement === document.body || document.activeElement === null) {
        anchorRef.current?.focus({ preventScroll: true });
        // Focus opens the card; the close that sent focus back keeps it shut.
        close();
      }
    }
  }, [open, anchorRef, close]);

  // Tab past either end of the card leaves it for where the picture sits in the page.
  const onCardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    if (e.key === "Escape") {
      anchor.focus({ preventScroll: true });
      return;
    }
    if (e.key !== "Tab") return;
    const inCard = [...e.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)];
    const edge = e.shiftKey ? inCard[0] : inCard[inCard.length - 1];
    if (document.activeElement !== edge) return;
    e.preventDefault();
    const next = e.shiftKey ? anchor : tabbableAfter(anchor, e.currentTarget);
    focusInside.current = false;
    close();
    (next ?? anchor).focus({ preventScroll: true });
  };

  return (
    <span
      {...wrapperProps}
      onMouseLeave={() => {
        if (!focusInside.current) wrapperProps.onMouseLeave();
      }}
      className="relative flex hover:z-20 focus-within:z-20"
    >
      <button
        {...anchorProps}
        type="button"
        aria-label={item.label ?? item.name}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        className={anchorClass(item)}
      >
        <Picture item={item} />
      </button>
      {open &&
        createPortal(
          <div
            {...popoverProps}
            id={cardId}
            role="dialog"
            aria-label={item.name}
            onKeyDown={onCardKeyDown}
            onFocus={() => {
              focusInside.current = true;
            }}
            onBlur={(e) => {
              const next = e.relatedTarget as Node | null;
              if (next && !e.currentTarget.contains(next)) {
                focusInside.current = false;
                if (next !== anchorRef.current) close();
              }
            }}
            className={`z-[2000] w-64 max-w-[calc(100vw-16px)] rounded-md p-3 text-xs ${TOOLTIP_SURFACE}`}
          >
            {item.renderCard()}
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * An overlapping row of pictures: the approval stamps in the event page's Approvals card.
 * Hover, focus or a click on a picture opens its card; a click pins the card and moves focus into
 * it, and Escape or tabbing out closes it and returns focus to the row. At most `max` show; the rest collapse into
 * a `+N` bubble, a button when `onOverflow` is set.
 */
export function AvatarStack({
  items,
  label,
  max = 5,
  onOverflow,
  overflowLabel = (hidden) => `${hidden} more`,
}: {
  items: AvatarStackItem[];
  /** The list's accessible name. */
  label: string;
  max?: number;
  onOverflow?: () => void;
  overflowLabel?: (hidden: number) => string;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, max);
  const hidden = items.length - shown.length;
  const bubble = cn(
    SIZE,
    "flex items-center justify-center rounded-full bg-neutral-800 text-neutral-300 font-medium",
    RING,
  );
  return (
    <ul aria-label={label} className="flex flex-wrap items-center gap-y-1 -space-x-1.5">
      {shown.map((item) => (
        <li key={item.key} className="flex shrink-0">
          {item.href ? <LinkedAvatar item={item} href={item.href} /> : <StackedAvatar item={item} />}
        </li>
      ))}
      {hidden > 0 && (
        <li className="relative flex shrink-0">
          {onOverflow ? (
            <button
              type="button"
              onClick={onOverflow}
              aria-label={overflowLabel(hidden)}
              className={cn(bubble, "hover:bg-neutral-700 transition-colors")}
            >
              +{hidden}
            </button>
          ) : (
            <span className={bubble}>+{hidden}</span>
          )}
        </li>
      )}
    </ul>
  );
}

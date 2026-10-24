"use client";

import {
  useCallback,
  useRef,
  type ComponentPropsWithRef,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import { usePinnedPopover } from "@/hooks/usePinnedPopover";
import { TOOLTIP_SURFACE } from "./styles";

/** Keyboard focus, not the focus a click or a tap leaves behind. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * The tooltip machinery: handlers for the control, a ref that makes it the anchor, and the
 * bubble. A mouse resting on the control or keyboard focus opens it; a touch never does, since a
 * tap acts and a bubble left standing after the finger lifts would cover the page. Placement and
 * dismissal (Escape, scroll, resize, an outside click) are `usePinnedPopover`'s. Only `tapClick`
 * pins, for a control whose label holds more than its name says (see `<Tooltip tapToShow>`).
 */
function useTooltip(label: string, hidden: boolean) {
  const { open, wrapperProps, anchorProps, popoverProps } = usePinnedPopover<HTMLSpanElement>();
  const { ref: wrapperRef } = wrapperProps;
  const { ref: anchorRef } = anchorProps;
  const attach = useCallback(
    (el: HTMLElement | null) => {
      wrapperRef.current = el;
      anchorRef.current = el as HTMLButtonElement | null;
    },
    [wrapperRef, anchorRef],
  );
  // The pointer that pressed last, read by the click it produces. Reset after each click, so a
  // keyboard activation, which presses no pointer, reads as a mouse.
  const pressedWith = useRef("mouse");
  const { onClick: pin } = anchorProps;
  // A touch's first tap on a closed bubble pins it instead of acting; the next tap acts.
  const tapClick = useCallback(
    (e: MouseEvent) => {
      const touch = pressedWith.current !== "mouse";
      pressedWith.current = "mouse";
      if (touch && !open) pin(e);
    },
    [open, pin],
  );
  return {
    attach,
    tapClick,
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        pressedWith.current = e.pointerType;
      },
      onPointerEnter: (e: PointerEvent) => {
        if (e.pointerType === "mouse") wrapperProps.onMouseEnter();
      },
      // A lifted finger fires `pointerleave` before its click: un-pinning there would close the
      // bubble a first tap opened, so the second tap would pin it again instead of acting.
      onPointerLeave: (e: PointerEvent) => {
        if (e.pointerType === "mouse") wrapperProps.onMouseLeave();
      },
      onFocus: (e: FocusEvent) => {
        if (focusVisible(e.currentTarget)) anchorProps.onFocus();
      },
      onBlur: anchorProps.onBlur,
    },
    bubble: open && !hidden && <Bubble label={label} popoverProps={popoverProps} />,
  };
}

/** The bubble, portalled to the end of the body. `aria-hidden`: the control's accessible name
 *  already says it. */
function Bubble({
  label,
  popoverProps,
}: {
  label: string;
  popoverProps: ReturnType<typeof usePinnedPopover<HTMLSpanElement>>["popoverProps"];
}) {
  return createPortal(
    <span
      {...popoverProps}
      aria-hidden="true"
      className={`pointer-events-none z-[2000] w-max max-w-[min(20rem,calc(100vw-16px))] rounded-md px-2 py-1 text-[11px] ${TOOLTIP_SURFACE}`}
    >
      {label}
    </span>,
    document.body,
  );
}

/** Calls each handler in turn, the caller's first. */
function both<E>(a: ((e: E) => void) | undefined, b: (e: E) => void) {
  return (e: E) => {
    a?.(e);
    b(e);
  };
}

/**
 * The `<button>` of `<Button icon>`: the same element, plus the tooltip showing `tip`. No wrapper
 * element, so a slot, a parent selector or a flex layout around the button sees the button.
 */
export function TooltipButton({
  tip,
  hidden = false,
  ref,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: ComponentPropsWithRef<"button"> & { tip: string; hidden?: boolean }) {
  const { attach, handlers, bubble } = useTooltip(tip, hidden);
  const setRef = useCallback(
    (el: HTMLButtonElement | null) => {
      attach(el);
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [attach, ref],
  );
  return (
    <>
      <button
        ref={setRef}
        onPointerEnter={both(onPointerEnter, handlers.onPointerEnter)}
        onPointerLeave={both(onPointerLeave, handlers.onPointerLeave)}
        onFocus={both(onFocus, handlers.onFocus)}
        onBlur={both(onBlur, handlers.onBlur)}
        {...props}
      />
      {bubble}
    </>
  );
}

/**
 * The same tooltip for an icon-only link (`buttonClasses("ghost", { icon: true })` on a `<Link>`
 * or an `<a>`), which `<Button>` cannot render: wrap the link. The wrapper is `display: contents`,
 * so the layout around the link is unchanged.
 *
 * `tapToShow` is for a link whose label is the only place a fact shows (who approved which
 * version when): a touch's first tap shows the bubble instead of following the link, and a
 * second tap on the same link follows it.
 */
export function Tooltip({
  label,
  tapToShow = false,
  children,
}: {
  label: string;
  tapToShow?: boolean;
  children: ReactNode;
}) {
  const { attach, handlers, tapClick, bubble } = useTooltip(label, false);
  const setRef: Ref<HTMLSpanElement> = useCallback(
    (el: HTMLSpanElement | null) => attach((el?.firstElementChild as HTMLElement | null) ?? null),
    [attach],
  );
  return (
    <span
      ref={setRef}
      className="contents"
      {...handlers}
      onClickCapture={tapToShow ? tapClick : undefined}
    >
      {children}
      {bubble}
    </span>
  );
}

"use client";

import { useEffect, useId, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

import { usePinnedPopover } from "@/hooks/usePinnedPopover";
import { httpHostname, linkKind } from "@/lib/outbound";
import { Button, buttonClasses } from "./Button";
import { POPOVER_SURFACE } from "./styles";

type OutboundLinkProps = Omit<
  ComponentPropsWithoutRef<"a">,
  "href" | "target" | "rel" | "onClick" | "onAuxClick"
> & {
  href: string;
  children: ReactNode;
  /** User-written content (a proof, a description, a bio): adds `nofollow ugc` to `rel`. */
  ugc?: boolean;
};

/**
 * Every link whose `href` is an absolute http(s) URL. The host decides what a click does
 * (`linkKind` in `lib/outbound.ts`):
 *
 * - Vidit's own domain routes in the app through `next/link`.
 * - A known host opens in a new tab in one click.
 * - Any other host opens a popover that shows the full URL and waits for an explicit
 *   confirmation. Middle and modifier clicks ask too.
 * - A value that is not an http(s) URL renders as its text.
 */
export function OutboundLink({ href, children, ugc = false, ...rest }: OutboundLinkProps) {
  const kind = linkKind(href);
  const rel = ugc ? "noopener noreferrer nofollow ugc" : "noopener noreferrer";

  if (kind === null) return <span className={rest.className}>{children}</span>;
  if (kind === "internal") {
    const { pathname, search, hash } = new URL(href);
    return (
      <Link href={`${pathname}${search}${hash}`} {...rest}>
        {children}
      </Link>
    );
  }
  if (kind === "known") {
    return (
      <a href={href} target="_blank" rel={rel} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <ConfirmedLink href={href} rel={rel} {...rest}>
      {children}
    </ConfirmedLink>
  );
}

function ConfirmedLink({
  href,
  rel,
  children,
  ...rest
}: Omit<OutboundLinkProps, "ugc"> & { rel: string }) {
  const { open, placed, close, anchorProps, popoverProps } = usePinnedPopover<HTMLAnchorElement>({
    hover: false,
  });
  const titleId = useId();
  const confirmRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (placed) confirmRef.current?.focus({ preventScroll: true });
  }, [placed]);

  const cancel = () => {
    close();
    anchorProps.ref.current?.focus();
  };

  return (
    <>
      <a
        {...rest}
        {...anchorProps}
        href={href}
        target="_blank"
        rel={rel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onAuxClick={(e) => {
          if (e.button === 1) anchorProps.onClick(e);
        }}
      >
        {children}
      </a>
      {open &&
        createPortal(
          <span
            {...popoverProps}
            role="dialog"
            aria-labelledby={titleId}
            className={`${POPOVER_SURFACE} block w-80 max-w-[calc(100vw-16px)] p-3 space-y-2 text-xs text-neutral-400`}
          >
            <span id={titleId} className="block text-sm font-medium text-neutral-100">
              Leave Vidit?
            </span>
            <span className="block">
              This link goes to {httpHostname(href)}, outside the sites Vidit opens directly. Check
              the full address first.
            </span>
            <span className="block break-all font-mono text-neutral-200">{href}</span>
            <span className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <a
                ref={confirmRef}
                href={href}
                target="_blank"
                rel={rel}
                // Closing in the click itself would unmount the anchor before the browser follows it.
                onClick={() => setTimeout(close, 0)}
                className={buttonClasses("primary")}
              >
                Open link
              </a>
            </span>
          </span>,
          document.body,
        )}
    </>
  );
}

"use client";

import { useState, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";

import { httpHostname, linkKind, linkTarget } from "@/lib/outbound";
import { Button } from "./Button";
import { Card } from "./Card";
import { MediaOverlay } from "./MediaLightbox";
import { TEXT_LINK } from "./styles";

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
 * - Any other host opens a centred dialog over the blurred page. The full URL in it is the
 *   only way on, so the reader reads the address to leave. Middle and modifier clicks ask too.
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
    <ConfirmedLink href={linkTarget(href)} rel={rel} {...rest}>
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
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const ask = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Safari does not focus a clicked link; the overlay returns focus to whatever holds it now.
    e.currentTarget.focus();
    setOpen(true);
  };

  return (
    <>
      <a
        {...rest}
        href={href}
        target="_blank"
        rel={rel}
        aria-haspopup="dialog"
        onClick={ask}
        onAuxClick={(e) => {
          if (e.button === 1) ask(e);
        }}
      >
        {children}
      </a>
      {open && (
        <MediaOverlay variant="dialog" label="Leave Vidit?" onClose={close}>
          <Card className="w-[min(28rem,calc(100vw-3rem))] space-y-3 border-orange-500/40 text-sm">
            <h2 className="text-base font-semibold text-neutral-100">
              Leave Vidit?
            </h2>
            <p className="text-neutral-400">
              This link goes to {httpHostname(href)}, outside the sites Vidit opens directly. Read
              the full address, then select it to continue.
            </p>
            <a
              href={href}
              target="_blank"
              rel={rel}
              // Closing in the click itself would unmount the anchor before the browser follows it.
              onClick={() => setTimeout(close, 0)}
              className={`block break-all font-mono text-xs ${TEXT_LINK}`}
            >
              {href}
            </a>
            <div className="flex justify-end">
              <Button action="cancel" variant="ghost" data-overlay-close="" onClick={close}>
                Cancel
              </Button>
            </div>
          </Card>
        </MediaOverlay>
      )}
    </>
  );
}

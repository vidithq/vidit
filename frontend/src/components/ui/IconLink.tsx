import type { ReactNode } from "react";
import Link from "next/link";

import { buttonClasses } from "./Button";
import { OutboundLink } from "./OutboundLink";
import { Tooltip } from "./Tooltip";

/**
 * An icon-only link: the shape of `<Button icon>` on an anchor, so a button never nests inside a
 * link. Like `<Button icon>`, it shows its name as a tooltip, `title` when that differs (a longer
 * hint). `external` routes the `href` through `<OutboundLink>`.
 */
export function IconLink({
  href,
  label,
  icon,
  title,
  external = false,
  variant = "ghost",
  className,
}: {
  href: string;
  /** The accessible name. */
  label: string;
  icon: ReactNode;
  title?: string;
  external?: boolean;
  variant?: "ghost" | "secondary";
  className?: string;
}) {
  const classes = buttonClasses(variant, { icon: true, className });
  const Anchor = external ? OutboundLink : Link;
  return (
    <Tooltip label={title ?? label}>
      <Anchor href={href} aria-label={label} className={classes}>
        {icon}
      </Anchor>
    </Tooltip>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { TAPPABLE_HOVER } from "./styles";
import { FORM_LABEL } from "./form-styles";
import { OutboundLink } from "./OutboundLink";

// "icon + label + value" link row (the About page's guide, legal and contact
// channels; the Notifications feed).
//
// - `href` present: a link; the value reads orange with the orange-border hover.
// - `href` absent: a <div>; the value stays neutral (names a destination without
//   resolving to one).
// - `external`: leaves the app through <OutboundLink> and takes the trailing
//   glyph, the one thing that promises a new tab. An in-app route (`href`
//   starting with "/") uses next/link; a same-tab non-route (`mailto:`) stays a
//   plain <a>.
// - `leading`: opt-in node shown in place of the icon (the Notifications feed's
//   actor picture); `icon` stays the fallback when it is unset.
// - `variant="arrow"` (opt-in, with `href`): the value stays neutral and wraps
//   instead of truncating, and an orange arrow at the right edge says where the
//   row goes. The link is stretched over the block, so `action` (a control such
//   as a delete button) sits inside the block, left of the arrow and above the
//   link, without nesting a control in an <a>.
const ROW =
  "group flex items-center gap-3 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md";

function RowLink({
  href,
  external,
  className,
  children,
}: {
  href: string;
  external: boolean;
  className: string;
  children: ReactNode;
}) {
  if (!external && href.startsWith("/")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  if (external) {
    return (
      <OutboundLink href={href} className={className}>
        {children}
      </OutboundLink>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export function LinkRow({
  icon: Icon,
  leading,
  label,
  value,
  href,
  external = true,
  variant = "accent",
  action,
}: {
  icon: LucideIcon;
  leading?: ReactNode;
  label: string;
  value: string;
  href?: string;
  external?: boolean;
  variant?: "accent" | "arrow";
  action?: ReactNode;
}) {
  const lead = leading ?? (
    <Icon
      size={14}
      className="text-neutral-500 shrink-0 group-hover:text-orange-400/70 transition-colors"
    />
  );

  if (href && variant === "arrow") {
    return (
      <div
        className={cn(ROW, TAPPABLE_HOVER, "relative has-[a:focus-visible]:border-orange-500/40")}
      >
        <RowLink
          href={href}
          external={external}
          className="flex flex-1 min-w-0 items-center gap-3 outline-hidden after:absolute after:inset-0 after:rounded-md"
        >
          {lead}
          <div className="flex-1 min-w-0">
            <span className={FORM_LABEL}>{label}</span>
            <p className="text-sm text-neutral-200 break-words">{value}</p>
          </div>
        </RowLink>
        {action && <div className="relative z-10 shrink-0">{action}</div>}
        <ArrowRight
          size={16}
          className="shrink-0 text-orange-400/70 transition-colors group-hover:text-orange-400 group-has-[a:focus-visible]:text-orange-400"
        />
      </div>
    );
  }

  const inner = (
    <>
      {lead}
      <div className="flex-1 min-w-0">
        <span className={FORM_LABEL}>{label}</span>
        <p
          className={`text-sm truncate ${
            href
              ? "text-orange-400 group-hover:text-orange-300 transition-colors"
              : "text-neutral-200"
          }`}
        >
          {value}
        </p>
      </div>
      {href && external && <ExternalLink size={12} className="text-orange-400/70 shrink-0" />}
    </>
  );

  if (!href) {
    return <div className={ROW}>{inner}</div>;
  }

  return (
    <RowLink href={href} external={external} className={`${ROW} ${TAPPABLE_HOVER}`}>
      {inner}
    </RowLink>
  );
}

import Link from "next/link";
import { ExternalLink, type LucideIcon } from "lucide-react";
import { TAPPABLE_HOVER } from "./styles";
import { FORM_LABEL } from "./form-styles";

// "icon + label + value" link row, carrying the About page's guide, legal and
// "Stay in touch" channels.
//
// - `href` present  -> renders a link; the value reads as orange and the row
//   gets the orange-border hover.
// - `href` absent   -> renders a <div>; the value stays neutral, for a value
//   that names a destination without resolving to one.
// - `external`      -> the row leaves the app: opens in a new tab and takes the
//   trailing ↗ glyph. The glyph tracks exactly this, so it is the one thing
//   that promises a new tab. An in-app route (`external` false, `href`
//   starting with "/") routes through next/link, and a same-tab non-route
//   (`mailto:`, also `external` false) stays a plain <a>; neither takes a
//   glyph, since neither leaves for a new tab.
const ROW =
  "group flex items-center gap-3 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md";

export function LinkRow({
  icon: Icon,
  label,
  value,
  href,
  external = true,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  href?: string;
  external?: boolean;
}) {
  const inner = (
    <>
      <Icon
        size={14}
        className="text-neutral-500 shrink-0 group-hover:text-orange-400/70 transition-colors"
      />
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
      {href && external && (
        <ExternalLink size={12} className="text-orange-400/70 shrink-0" />
      )}
    </>
  );

  if (!href) {
    return <div className={ROW}>{inner}</div>;
  }

  const rowClass = `${ROW} ${TAPPABLE_HOVER}`;

  if (!external && href.startsWith("/")) {
    return (
      <Link href={href} className={rowClass}>
        {inner}
      </Link>
    );
  }

  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={rowClass}
    >
      {inner}
    </a>
  );
}

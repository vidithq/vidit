import { ExternalLink, type LucideIcon } from "lucide-react";
import { TAPPABLE_HOVER } from "./styles";
import { FORM_LABEL } from "./form-styles";

// "icon + label + value" link row, shared by the profile's linked-accounts and
// the About page's "Stay in touch" channels (it was hand-rolled in both).
//
// - `href` present  -> renders an <a>; the value reads as an orange link, the
//   row gets the orange-border hover, and the trailing link icon shows. The
//   icon tracks "is this a link", not the kind of link, so it's uniform across
//   a row group (a mailto looks like the other links).
// - `href` absent   -> renders a <div>; the value stays neutral and there's no
//   icon (a plain handle that doesn't resolve to a URL, e.g. a Discord name).
// - `external`      -> opens the link in a new tab (off for `mailto:`).
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
      {href && (
        <ExternalLink size={12} className="text-orange-400/70 shrink-0" />
      )}
    </>
  );

  if (!href) {
    return <div className={ROW}>{inner}</div>;
  }

  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`${ROW} ${TAPPABLE_HOVER}`}
    >
      {inner}
    </a>
  );
}

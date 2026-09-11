import { safeHostname } from "@/lib/format";
import { cn } from "@/lib/cn";
import { TEXT_LINK } from "@/components/ui/styles";

type SourceLabelProps = {
  /** Null on a machine detection whose tweet declared no source:
   *  renders the muted "To confirm" label instead of a link. */
  url: string | null;
  /** Appended Tailwind classes. The atom sets palette + affordance; the caller
   *  owns text size, margin, and layout. */
  className?: string;
  /** ``"link"`` is a clickable ``<a target=_blank>`` for detail surfaces where
   *  the source URL is the primary outbound affordance. ``"inline"`` is plain
   *  text for list cards where the whole card is already the click target; an
   *  inner ``<a>`` would nest links. */
  variant: "link" | "inline";
};

/**
 * Source-URL display that reduces a stored URL to its host, with italic
 * fallbacks for the two cases that have no link to offer. A null ``url`` (a
 * machine detection whose tweet declared no source) renders "To
 * confirm"; a value the parser gives no host for renders "no source". One edit
 * point for the rendering, which had already drifted (``text-neutral-500`` vs
 * ``-600``).
 */
export function SourceLabel(props: SourceLabelProps) {
  const { url, className } = props;
  if (url === null) {
    return <span className={cn("italic text-neutral-500", className)}>To confirm</span>;
  }
  const hostname = safeHostname(url);
  // A non-null url can still fail to parse on corrupt data: surface a
  // readable label rather than an empty anchor / span.
  if (!hostname) {
    return <span className={cn("italic text-neutral-500", className)}>no source</span>;
  }
  if (props.variant === "inline") {
    return <span className={className}>{hostname}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // `min-w-0` rather than a width ceiling: the link is a flex item on every
      // surface that shows it, and a flex item's automatic floor is the width
      // of the whole hostname, which is what pushes a row past its card. With
      // the floor lifted, `truncate` cuts the host to whatever the row leaves,
      // so the same link reads correctly in a 200px column and in a wide one.
      className={cn(`${TEXT_LINK} truncate min-w-0`, className)}
    >
      {hostname}
    </a>
  );
}

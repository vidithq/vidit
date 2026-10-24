import { safeHostname, shortUrl } from "@/lib/format";
import { cn } from "@/lib/cn";
import { OutboundLink } from "@/components/ui/OutboundLink";
import { TEXT_LINK } from "@/components/ui/styles";

type SourceLabelProps = {
  /** Null on a machine detection with no declared source: renders "To confirm". */
  url: string | null;
  /** The atom sets palette and affordance; the caller owns size, margin, layout. */
  className?: string;
  /** `"link"`: a clickable anchor for detail surfaces. `"inline"`: plain text for
   *  list cards, where an inner `<a>` would nest links. */
  variant: "link" | "inline";
  /** Names the link by host and path (`shortUrl`), for a list where two links share a host. */
  withPath?: boolean;
};

/**
 * Source-URL display that reduces a stored URL to its host (or its `shortUrl` with `withPath`), with italic
 * fallbacks: "To confirm" for a null `url`, "no source" for a value with no host.
 */
export function SourceLabel(props: SourceLabelProps) {
  const { url, className } = props;
  if (url === null) {
    return <span className={cn("italic text-neutral-500", className)}>To confirm</span>;
  }
  const hostname = safeHostname(url);
  // Corrupt data can still fail to parse: show a label, not an empty anchor.
  if (!hostname) {
    return <span className={cn("italic text-neutral-500", className)}>no source</span>;
  }
  const name = props.withPath ? shortUrl(url) : hostname;
  if (props.variant === "inline") {
    return <span className={className}>{name}</span>;
  }
  return (
    <OutboundLink
      href={url}
      // `min-w-0`: a flex item's automatic floor is the whole hostname, which
      // pushes a row past its card; with it lifted, `truncate` fits the row.
      className={cn(`${TEXT_LINK} truncate min-w-0`, className)}
    >
      {name}
    </OutboundLink>
  );
}

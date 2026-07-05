import { safeHostname } from "@/lib/format";
import { cn } from "@/lib/cn";
import { TEXT_LINK } from "@/components/ui/styles";

/**
 * Discriminated union — ``maxWidthClass`` is required in link mode (without a
 * width ceiling a long hostname overflows the parent) and forbidden in inline
 * mode, catching a forgetful caller at the type level rather than as a layout
 * bug.
 */
type SourceLabelProps = {
  isDemo: boolean;
  /** Null on a machine ``detected`` draft whose tweet declared no source:
   *  renders the muted "To confirm" label instead of a link. */
  url: string | null;
  /** Appended Tailwind classes. The atom sets palette + affordance; the caller
   *  owns text size, margin, and layout. */
  className?: string;
} & (
  | {
      /** ``"link"`` — clickable ``<a target=_blank>`` for detail surfaces where
       *  the source URL is the primary outbound affordance. */
      variant: "link";
      /** Tailwind max-width class (e.g. ``"max-w-[300px]"``). */
      maxWidthClass: string;
    }
  | {
      /** ``"inline"`` — plain text for list cards where the whole card is
       *  already the click target; an inner ``<a>`` would nest links. */
      variant: "inline";
      maxWidthClass?: never;
    }
);

/**
 * Source-URL display that handles the demo sentinel and the sourceless draft
 * uniformly. Demo rows carry a synthetic ``source_url`` that doesn't resolve,
 * so linking it would 404 the tester: render an italic "synthetic" label
 * instead. A null ``url`` (a machine ``detected`` draft whose tweet declared
 * no source) renders an italic "To confirm" label the same way, since neither
 * case has a real link to offer. One edit point for the rendering, which had
 * already drifted (``text-neutral-500`` vs ``-600``).
 */
export function SourceLabel(props: SourceLabelProps) {
  const { isDemo, url, className } = props;
  if (url === null) {
    return <span className={cn("italic text-neutral-500", className)}>To confirm</span>;
  }
  if (isDemo) {
    return <span className={cn("italic text-neutral-500", className)}>synthetic</span>;
  }
  const hostname = safeHostname(url);
  // A non-null, non-demo url can still fail to parse on corrupt data:
  // surface a readable label rather than an empty anchor / span.
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
      className={cn(`${TEXT_LINK} truncate`, props.maxWidthClass, className)}
    >
      {hostname}
    </a>
  );
}

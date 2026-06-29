import { safeHostname } from "@/lib/format";
import { TEXT_LINK } from "@/components/ui/styles";

/**
 * Discriminated union — ``maxWidthClass`` is required in link mode (without a
 * width ceiling a long hostname overflows the parent) and forbidden in inline
 * mode, catching a forgetful caller at the type level rather than as a layout
 * bug.
 */
type SourceLabelProps = {
  isDemo: boolean;
  url: string;
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
 * Source-URL display that handles the demo sentinel uniformly. Demo rows carry
 * a synthetic ``source_url`` that doesn't resolve, so linking it would 404 the
 * tester — render an italic "synthetic" label instead. One edit point for the
 * rendering, which had already drifted (``text-neutral-500`` vs ``-600``).
 */
export default function SourceLabel(props: SourceLabelProps) {
  const { isDemo, url, className } = props;
  if (isDemo) {
    return <span className={cx("italic text-neutral-500", className)}>synthetic</span>;
  }
  const hostname = safeHostname(url);
  // The DB column is non-nullable, so this only fires on corrupt data —
  // surface a readable label rather than an empty anchor / span.
  if (!hostname) {
    return <span className={cx("italic text-neutral-500", className)}>no source</span>;
  }
  if (props.variant === "inline") {
    return <span className={className}>{hostname}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cx(`${TEXT_LINK} truncate`, props.maxWidthClass, className)}
    >
      {hostname}
    </a>
  );
}

/**
 * Filter falsy class tokens before joining — avoids the double-space artefact
 * ``.trim()`` can't fix when a middle slot is empty.
 */
function cx(...tokens: (string | undefined | null | false)[]): string {
  return tokens.filter(Boolean).join(" ");
}

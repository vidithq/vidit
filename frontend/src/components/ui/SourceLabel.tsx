import { safeHostname } from "@/lib/format";

/**
 * Discriminated union — ``maxWidthClass`` is required when rendering an
 * anchor (truncation has no width ceiling otherwise, so a long
 * hostname overflows the parent), and forbidden in inline mode where
 * there's no anchor to truncate. Catches a forgetful caller at the
 * type level instead of letting it ship as a layout bug.
 */
type SourceLabelProps = {
  isDemo: boolean;
  url: string;
  /**
   * Extra Tailwind classes appended to the rendered element. The atom
   * sets size-agnostic palette + affordance classes; the caller
   * controls text size, margin, and any layout integration with the
   * surrounding row.
   */
  className?: string;
} & (
  | {
      /**
       * ``"link"`` — clickable ``<a target=_blank>`` for the live case,
       * with truncate + max-width + orange-affordance styling. Used on
       * detail surfaces where the source URL is the primary outbound
       * affordance.
       */
      variant: "link";
      /** Tailwind max-width class (e.g. ``"max-w-[300px]"``). */
      maxWidthClass: string;
    }
  | {
      /**
       * ``"inline"`` — plain text (no anchor) for the live case. Used
       * inside list cards where the whole card is already the click
       * target; an inner ``<a>`` would create a nested-link foot-gun
       * and double-click target.
       */
      variant: "inline";
      maxWidthClass?: never;
    }
);

/**
 * Source-URL display that handles the demo sentinel uniformly.
 *
 * Demo geolocations and bounties carry a synthetic ``source_url`` that
 * doesn't resolve to a real page — surfacing it as a clickable link
 * would 404 the beta tester. This atom renders an italic "synthetic"
 * label in that case instead, and a real anchor (or plain hostname)
 * otherwise. Standardising the rendering closes a colour drift that
 * had already crept in (``text-neutral-500`` vs ``text-neutral-600``
 * across surfaces) and gives the eventual "demo rows link to a
 * placeholder page instead" swap a single edit point.
 */
export default function SourceLabel(props: SourceLabelProps) {
  const { isDemo, url, className } = props;
  if (isDemo) {
    return <span className={cx("italic text-neutral-500", className)}>synthetic</span>;
  }
  const hostname = safeHostname(url);
  // Defensive: ``safeHostname`` returns the raw input on a parse failure,
  // and an empty input returns an empty string. The DB column is
  // non-nullable today, so this branch only fires on corrupt data —
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
      className={cx("text-orange-400 hover:underline truncate", props.maxWidthClass, className)}
    >
      {hostname}
    </a>
  );
}

/**
 * Filter empty / undefined class tokens before joining. Avoids the
 * double-space + leading/trailing whitespace artefacts that ``.trim()``
 * alone can't clean up when the middle slot is empty.
 */
function cx(...tokens: (string | undefined | null | false)[]): string {
  return tokens.filter(Boolean).join(" ");
}

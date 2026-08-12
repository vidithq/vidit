import { cn } from "@/lib/cn";
import { TEXT_LINK } from "@/components/ui/styles";

interface ArchivedCopyLinkProps {
  /** The capture the archival worker took. Null until it has one, and on a
   *  link that was never queued: the component renders nothing, so callers
   *  hand it the field straight off the payload without their own guard. */
  href: string | null;
  /** What the capture is of, folded into the accessible name ("the source",
   *  a mirror's hostname). The visible "archived" text is the same on every
   *  instance, so a page carrying several needs each named for what it points
   *  at; `title` is not announced, so it cannot carry that. */
  describes: string;
  /** Appended Tailwind classes: the caller owns spacing inside its row. */
  className?: string;
}

/**
 * The archived-copy fallback beside an outbound source link. Sits next to the
 * original rather than replacing it: the original stays the primary link while
 * it resolves, and the capture is one click away the day it stops.
 *
 * One component for the primary source and every secondary mirror, so the same
 * fact cannot grow two affordances.
 */
export function ArchivedCopyLink({ href, describes, className }: ArchivedCopyLinkProps) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Archived copy, readable if the source is taken down"
      aria-label={`Archived copy of ${describes}`}
      className={cn(TEXT_LINK, "ml-2 shrink-0 text-xs", className)}
    >
      archived
    </a>
  );
}

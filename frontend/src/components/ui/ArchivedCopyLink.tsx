import { TEXT_LINK } from "@/components/ui/styles";

interface ArchivedCopyLinkProps {
  /** The capture the archival worker took. Null until it has one, and on a
   *  link that was never queued: the component renders nothing, so callers
   *  hand it the field straight off the payload without their own guard. */
  href: string | null;
  /** What the capture is of, folded into the accessible name ("the source",
   *  "mirror 2, t.me"). The visible "archived" text is the same on every
   *  instance, so a page carrying several needs each named for what it points
   *  at; `title` is not announced, so it cannot carry that. Build a mirror's
   *  value with `mirrorDescription`, which keeps two mirrors on one host
   *  tellable apart. */
  describes: string;
}

/**
 * The archived-copy fallback beside an outbound source link. Sits next to the
 * original rather than replacing it: the original stays the primary link while
 * it resolves, and the capture is one click away the day it stops.
 *
 * One component for the primary source and every secondary mirror, so the same
 * fact cannot grow two affordances.
 */
export function ArchivedCopyLink({ href, describes }: ArchivedCopyLinkProps) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Archived copy, readable if the source is taken down"
      aria-label={`Archived copy of ${describes}`}
      className={`${TEXT_LINK} ml-2 shrink-0 text-xs`}
    >
      archived
    </a>
  );
}

/** The primary source's own name, kept distinct from every mirror's. */
export const PRIMARY_SOURCE_DESCRIPTION = "the source";

/**
 * One mirror's `describes` value: its host, prefixed by its position whenever
 * the list holds more than one.
 *
 * The host alone is not an identity. Two mirrors of the same channel share it,
 * which leaves two links on the page with one accessible name, and a URL the
 * parser refuses has no host to show at all. The position disambiguates the
 * first case and a literal covers the second, so every archived link on the
 * page announces something a reader can act on.
 */
export function mirrorDescription(hostname: string, index: number, total: number): string {
  const host = hostname.trim();
  if (total < 2) return host || "this mirror";
  return host ? `mirror ${index + 1}, ${host}` : `mirror ${index + 1}`;
}
